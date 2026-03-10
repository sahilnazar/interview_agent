import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import chokidar from "chokidar";
import pdfParse from "pdf-parse";

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

  const processing = new Set();

  async function processCV(filePath) {
    const basename = path.basename(filePath);
    if (processing.has(filePath)) return;
    processing.add(filePath);

    try {
      await new Promise((r) => setTimeout(r, 1000));

      if (!fs.existsSync(filePath)) return;

      // Extract interview ID from parent folder name
      const parentDir = path.basename(path.dirname(filePath));
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_REGEX.test(parentDir)) {
        console.warn(`CV watcher: ${basename} is not inside an interview folder — skipped (place in cvs/<interview_id>/)`);
        return;
      }
      const interviewId = parentDir;

      const buf = fs.readFileSync(filePath);
      if (buf.length === 0) { console.warn(`CV watcher: ${basename} is empty — skipped`); return; }

      let resumeText = "";
      try {
        const pdfData = await pdfParse(buf);
        resumeText = pdfData.text;
      } catch {
        resumeText = buf.toString("utf-8");
      }

      const emails = resumeText.match(EMAIL_REGEX) || [];
      const nameWithoutExt = basename.replace(/\.pdf$/i, "");
      const filenameEmails = nameWithoutExt.match(EMAIL_REGEX) || [];
      const candidateEmail = filenameEmails[0] || emails[0];

      if (!candidateEmail) {
        console.warn(`CV watcher: No email found in ${basename} — skipped (rename file to email@domain.pdf)`);
        return;
      }

      const threadId = uuidv4();
      const config = { configurable: { thread_id: threadId } };

      console.log(`CV watcher: Processing ${basename} → ${candidateEmail} (interview: ${interviewId})`);

      compiledGraph
        .invoke({ candidateEmail, resumeBuffer: buf, threadId, interviewId }, config)
        .then(() => console.log(`CV watcher: Graph completed for ${candidateEmail} (${threadId})`))
        .catch((err) => console.error(`CV watcher: Graph error for ${candidateEmail}:`, err.message));

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
      if (path.extname(filePath).toLowerCase() === ".pdf") {
        processCV(filePath);
      }
    });

  console.log(`CV watcher: Watching ${cvsDir} for new PDFs (place in cvs/<interview_id>/ subfolders)`);
}
