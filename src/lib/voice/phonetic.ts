// Phonetic clean-up for the TTS request only. The script, the subtitles and everything shown on screen keep the
// original text; only what the voice model reads changes. Pure and deterministic (no AI), so it's unit-tested.
//   "Uco & Ocu"  → "U-co dan Ocu"   ("&" read as Indonesian "dan"; "Uco" split so it isn't slurred into "Ucu")

/** Every way the handle gets written: "@uco.ocu", "uco . ocu", "uco titik ocu", "uco dot ocu" (and "akun …" before it). */
export const HANDLE_SPELLINGS = /(?:\b(?:akun|account)\s+)?@?\buco\s*(?:\.|\s(?:titik|dot)\s)\s*ocu\b/gi;

const RULES: [RegExp, string][] = [
  // the show's handle, "@uco.ocu" (or spelled out: "uco titik ocu", "uco dot ocu") → "Uco Ocu", never a spoken dot
  // (then "Uco" → "U-co" below)
  [HANDLE_SPELLINGS, "Uco Ocu"],
  // "&" between words → "dan" (also "&amp;" from pasted HTML)
  [/\s*&(?:amp;)?\s*/g, " dan "],
  // the character's name, any case, as a whole word (keeps a trailing "-nya", "'s" etc.)
  [/\bUco\b/gi, "U-co"],
];

/**
 * The text the voice model should read for a script line (never shown to anyone). Gemini TTS reads "U-co" the
 * Spanish / English way ("Uko"), so its transcript spells the names the way they sound: "Ucho", "Ochu". Edge TTS's
 * Indonesian voice reads "c" as /tʃ/ already and keeps "U-co" / "Ocu".
 */
export function ttsText(text: string, voice: "gemini" | "edge" = "edge"): string {
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to);
  if (voice === "gemini") out = out.replace(/\bU-co\b/g, "Ucho").replace(/\bOcu\b/gi, "Ochu");
  return out.replace(/\s{2,}/g, " ").trim();
}

/** The handle written properly ("@uco.ocu") wherever a script or subtitle spelled it out ("uco titik ocu", "uco dot ocu"). */
export function cleanHandle(text: string): string;
export function cleanHandle(text: string | null | undefined): string | null | undefined;
export function cleanHandle(text: string | null | undefined) {
  return text == null ? text : text.replace(HANDLE_SPELLINGS, "@uco.ocu");
}
