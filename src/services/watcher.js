import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import chokidar from "chokidar";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { extractPdfText } from "./pdf-extract.js";
import { matchResumeToInterview } from "./interview-matcher.js";

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/**
 * Start watching cvs/<interview_id>/ subfolders for new PDF CVs.
 * Folder structure: cvs/<uuid>/<email>.pdf
 * The interview ID is extracted from the parent folder name.
 *
 * @param {string} cvsDir       – root cvs/ folder
 * @param {string} processedDir – folder to move processed files
 * @param {object} compiledGraph – compiled LangGraph instance
 */
export function startCVWatcher(cvsDir, processedDir, compiledGraph) {
  fs.mkdirSync(cvsDir, { recursive: true });
  fs.mkdirSync(processedDir, { recursive: true });
  // Ensure the auto folder exists
  fs.mkdirSync(path.join(cvsDir, "auto"), { recursive: true });

  const processing = new Set();
  const queue = [];
  let running = false;

  async function drainQueue() {
    if (running) return;
    running = true;
    while (queue.length > 0) {
      const filePath = queue.shift();
      await processCV(filePath);
    }
    running = false;
  }

  function enqueue(filePath) {
    if (processing.has(filePath)) return;
    queue.push(filePath);
    drainQueue();
  }

  async function processCV(filePath) {
    const basename = path.basename(filePath);
    if (processing.has(filePath)) return;
    processing.add(filePath);

    try {
      await new Promise((r) => setTimeout(r, 1000));

      if (!fs.existsSync(filePath)) return;

      // Determine assignment mode from parent folder
      const parentDir = path.basename(path.dirname(filePath));
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const isAutoFolder = parentDir.toLowerCase() === "auto";

      if (!isAutoFolder && !UUID_REGEX.test(parentDir)) {
        console.warn(`CV watcher: ${basename} is not inside an interview or auto folder — skipped`);
        return;
      }

      const buf = fs.readFileSync(filePath);
      if (buf.length === 0) { console.warn(`CV watcher: ${basename} is empty — skipped`); return; }

      // Extract text for email detection (and auto-matching)
      let resumeText = "";
      const ext = path.extname(filePath).toLowerCase();
      try {
        if (ext === ".docx") {
          const result = await mammoth.extractRawText({ buffer: buf });
          resumeText = (result.value || "").trim();
        } else if (ext === ".doc") {
          const extractor = new WordExtractor();
          const doc = await extractor.extract(buf);
          resumeText = (doc.getBody() || "").trim();
        } else {
          resumeText = await extractPdfText(buf);
        }
      } catch {
        resumeText = buf.toString("utf-8");
      }

      const emails = resumeText.match(EMAIL_REGEX) || [];
      const nameWithoutExt = basename.replace(/\.(pdf|docx?|)$/i, "");
      const filenameEmails = nameWithoutExt.match(EMAIL_REGEX) || [];
      const candidateEmail = filenameEmails[0] || emails[0];

      if (!candidateEmail) {
        console.warn(`CV watcher: No email found in ${basename} — skipped (rename file to email@domain.pdf/.doc/.docx)`);
        return;
      }

      // Resolve interview ID
      let interviewId;
      let assignmentMethod = "manual";
      let matchConfidence = null;

      if (isAutoFolder) {
        const match = await matchResumeToInterview(resumeText);
        if (!match) {
          console.warn(`CV watcher: Auto-match failed for ${basename} — no suitable interview found`);
          return;
        }
        interviewId = match.interviewId;
        assignmentMethod = "auto";
        matchConfidence = match.confidence;
        console.log(`CV watcher: Auto-assigned ${basename} → "${match.title}" (${match.confidence}%)`);
      } else {
        interviewId = parentDir;
      }

      const threadId = uuidv4();
      const config = { configurable: { thread_id: threadId } };

      console.log(`CV watcher: Processing ${basename} → ${candidateEmail} (interview: ${interviewId}, ${assignmentMethod})`);

      try {
        await compiledGraph.invoke(
          { candidateEmail, resumeBuffer: buf, threadId, interviewId, assignmentMethod, matchConfidence },
          config
        );
        console.log(`CV watcher: Graph completed for ${candidateEmail} (${threadId})`);
      } catch (err) {
        console.error(`CV watcher: Graph error for ${candidateEmail}:`, err.message);
      }

      const dest = path.join(processedDir, `${Date.now()}-${basename}`);
      fs.renameSync(filePath, dest);
      console.log(`CV watcher: Moved ${basename} → processed/`);
    } catch (err) {
      console.error(`CV watcher: Error processing ${basename}:`, err.message);
    } finally {
      processing.delete(filePath);
    }
  }

  chokidar
    .watch(cvsDir, {
      ignored: [processedDir, /(^|[\/\\])\..*/],
      depth: 1,
      ignoreInitial: false,
    })
    .on("add", (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === ".pdf" || ext === ".doc" || ext === ".docx") {
        enqueue(filePath);
      }
    });

  console.log(`CV watcher: Watching ${cvsDir} for new PDF/DOC/DOCX files (place in cvs/<interview_id>/ or cvs/auto/)`);
}
