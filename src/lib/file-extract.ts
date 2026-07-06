import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

// Knowledge-base file parsing. Hard caps guard the serverless window and the
// downstream contextualize/embed fan-out.

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 300;
const MAX_TEXT_CHARS = 400_000;

const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv)$/i;

export function supportedKnowledgeFile(name: string): boolean {
  return /\.(pdf|docx)$/i.test(name) || TEXT_EXTENSIONS.test(name);
}

/** Extracts plain text from an uploaded knowledge file. Throws typed errors for the action to map. */
export async function extractFileText(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error("FILE_TOO_LARGE");
  const name = file.name || "";

  if (TEXT_EXTENSIONS.test(name)) {
    return (await file.text()).slice(0, MAX_TEXT_CHARS);
  }

  const buffer = new Uint8Array(await file.arrayBuffer());

  if (/\.pdf$/i.test(name)) {
    const pdf = await getDocumentProxy(buffer);
    if (pdf.numPages > MAX_PDF_PAGES) throw new Error("PDF_TOO_LONG");
    const { text } = await extractText(pdf, { mergePages: true });
    return String(text ?? "").slice(0, MAX_TEXT_CHARS);
  }

  if (/\.docx$/i.test(name)) {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    return String(result.value ?? "").slice(0, MAX_TEXT_CHARS);
  }

  throw new Error("UNSUPPORTED_FILE");
}
