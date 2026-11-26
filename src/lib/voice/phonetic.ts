// Phonetic clean-up for the TTS request only. The script, the subtitles and everything shown on screen keep the
// original text; only what the voice model reads changes. Pure and deterministic (no AI), so it's unit-tested.
//   "Uco & Ocu"  → "U-co dan Ocu"   ("&" read as Indonesian "dan"; "Uco" split so it isn't slurred into "Ucu")

const RULES: [RegExp, string][] = [
  // the show's handle, "@uco.ocu" → "Uco Ocu" (then "Uco" → "U-co" below)
  [/@uco\.ocu\b/gi, "Uco Ocu"],
  // "&" between words → "dan" (also "&amp;" from pasted HTML)
  [/\s*&(?:amp;)?\s*/g, " dan "],
  // the character's name, any case, as a whole word (keeps a trailing "-nya", "'s" etc.)
  [/\bUco\b/gi, "U-co"],
];

/** The text the voice model should read for a script line (never shown to anyone). */
export function ttsText(text: string): string {
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out.replace(/\s{2,}/g, " ").trim();
}
