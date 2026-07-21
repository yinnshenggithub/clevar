// Pure, dependency-free citation helpers — safe to import from client components.

/** Strips inline citation markers like [1]/[12] for plain-text rendering. */
export function stripCitations(text: string): string {
  return text
    .replace(/\s*\[\d{1,2}\](?=[\s.,;:!?)]|$)/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}
