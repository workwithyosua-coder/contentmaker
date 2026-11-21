// Text measuring without a browser (Montserrat 900 glyph widths), so layouts that depend on text size are exact and
// unit-testable. Pure code: no CSS or React imports.

/** Montserrat 900 glyph widths in em, measured in Chromium (unknown characters count as 0.9 em). */
const GLYPH_EM: Record<string, number> = { "0": 0.69, "1": 0.42, "2": 0.61, "3": 0.61, "4": 0.71, "5": 0.62, "6": 0.66, "7": 0.65, "8": 0.68, "9": 0.66, "A": 0.81, "B": 0.77, "C": 0.74, "D": 0.83, "E": 0.67, "F": 0.64, "G": 0.77, "H": 0.8, "I": 0.35, "J": 0.57, "K": 0.77, "L": 0.62, "M": 0.95, "N": 0.8, "O": 0.85, "P": 0.74, "Q": 0.85, "R": 0.75, "S": 0.66, "T": 0.65, "U": 0.78, "V": 0.79, "W": 1.21, "X": 0.76, "Y": 0.71, "Z": 0.69, " ": 0.3, ".": 0.3, ",": 0.3, "!": 0.31, "?": 0.61, ":": 0.3, ";": 0.3, "%": 0.92, "&": 0.78, "=": 0.62, "+": 0.62, "-": 0.39, "/": 0.44, "(": 0.38, ")": 0.38, "'": 0.25, "\"": 0.49, "#": 0.74, "@": 1.04, "\u00d7": 0.62, "\u00c9": 0.67, "\u00c8": 0.67, "\u00c0": 0.81 };
/** Text width in px at `size`, with 4% headroom so our line breaks are never later than the browser's would be. */
export const textWidth = (t: string, size: number) => [...t].reduce((a, c) => a + (GLYPH_EM[c] ?? GLYPH_EM[c.toUpperCase()] ?? 0.9), 0) * size * 1.04;

/**
 * Wraps a headline into lines that fit `width` px. Breaking ourselves (instead of letting the browser wrap) makes
 * the card's height exact, so the characters can start right under it without ever touching it.
 */
export function wrapHeadline(text: string, size: number, width: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && textWidth(next, size) > width) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
