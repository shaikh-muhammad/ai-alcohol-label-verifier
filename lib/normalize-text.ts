/** Standardize likely formatting differences while preserving meaningful content. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—−]/g, "-")
    // Treat common text separators as word boundaries, never join words.
    // Preserve punctuation between digits (e.g. 1,000 or 12:30), decimal points,
    // apostrophes, hyphens, slashes, and symbols with potential meaning.
    .replace(/[,;:!?]+/g, (punctuation, offset: number, input: string) =>
      /\d/.test(input[offset - 1] ?? "") && /\d/.test(input[offset + punctuation.length] ?? "")
        ? punctuation
        : " ",
    )
    .replace(/\s+/g, " ")
    // Remove padding inside parentheses and square brackets.
    .replace(/([\(\[]) +/g, "$1")
    .replace(/ +([)\]])/g, "$1")
    .trim();
}
