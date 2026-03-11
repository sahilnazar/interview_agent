import pdfParse from "pdf-parse";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Extract text from a PDF buffer with multiple fallback strategies.
 * 1. pdf-parse (fast, old pdf.js)
 * 2. pdfjs-dist (modern pdf.js — handles bad XRef, linearized PDFs, etc.)
 * 3. Raw BT/ET + Tj regex extraction from PDF bytes
 *
 * @param {Buffer} buf
 * @returns {Promise<string>}
 */
export async function extractPdfText(buf) {
  let text = "";

  // Strategy 1: pdf-parse
  try {
    const data = await pdfParse(buf);
    text = (data.text || "").trim();
  } catch {
    // fall through
  }

  // Strategy 2: pdfjs-dist (modern parser)
  if (text.length < 100) {
    try {
      const uint8 = new Uint8Array(buf);
      const doc = await getDocument({ data: uint8, useSystemFonts: true }).promise;
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => item.str).join(" "));
      }
      const extracted = pages.join("\n").trim();
      if (extracted.length > text.length) {
        text = extracted;
      }
    } catch {
      // fall through
    }
  }

  // Strategy 3: raw byte extraction (BT/ET blocks + Tj strings)
  if (text.length < 100) {
    const raw = buf.toString("latin1");
    const btEtMatches = raw.match(/BT[\s\S]*?ET/g);
    if (btEtMatches) {
      const extracted = btEtMatches
        .join(" ")
        .replace(/\\[nrt]/g, " ")
        .replace(/[^\x20-\x7E\n]/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (extracted.length > text.length) text = extracted;
    }
    if (text.length < 100) {
      const tjStrings = raw.match(/\(([^)]{2,})\)\s*Tj/g);
      if (tjStrings) {
        const extracted = tjStrings
          .map((s) => s.replace(/^\(|\)\s*Tj$/g, ""))
          .join(" ")
          .trim();
        if (extracted.length > text.length) text = extracted;
      }
    }
  }

  return text;
}
