// Phonetic clean-up for the TTS request only. The script, the subtitles and everything shown on screen keep the
// original text; only what the voice model reads changes. Pure and deterministic (no AI), so it's unit-tested.
//   "Uco & Ocu"  → "U-co dan Ocu"   ("&" read as Indonesian "dan"; "Uco" split so it isn't slurred into "Ucu")
//   "POD", "QRIS", "BPJS" → "pod", "kris", "be-pe-je-es"   (acronyms as words / Indonesian letter names)

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
 * Acronyms read as words, or spelled the Indonesian way, instead of letter by letter in English ("P-O-D"). Written
 * in capitals in a script; the subtitles keep them as written. Whole words only (a trailing "-nya" stays).
 */
export const ACRONYMS: Record<string, string> = {
  POD: "pod",
  VAPE: "vape",
  EVALI: "evali",
  NEET: "nit",
  FOMO: "fomo",
  YOLO: "yolo",
  QRIS: "kris",
  BPJS: "be-pe-je-es",
  UMKM: "u-em-ka-em",
};
const ACRONYM_RX = new RegExp(`\\b(${Object.keys(ACRONYMS).join("|")})\\b`, "g");

/** A Pronunciation Dictionary row (/insights): the written term (stored trimmed, lower-case) and what to say instead. */
export type PronunciationOverride = { term: string; spoken_as: string };

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The owner's pronunciation fixes, for the TTS request only (the script and subtitles never change): each term matched
 * case-insensitively as a whole word or phrase (not inside a longer word), longest term first, so "kopi susu gula aren"
 * wins over "kopi susu". Applied before the built-in rules, so an owner fix always takes precedence.
 */
export function applyOverrides(text: string, overrides: readonly PronunciationOverride[]): string {
  const rows = overrides
    .map((o) => ({ term: o.term.replace(/\s+/g, " ").trim().toLowerCase(), spoken: o.spoken_as.replace(/\s+/g, " ").trim() }))
    .filter((o) => o.term && o.spoken)
    .sort((a, b) => b.term.length - a.term.length);
  if (!rows.length) return text;
  const map = new Map(rows.map((o) => [o.term, o.spoken]));
  const rx = new RegExp(`(?<![\\p{L}\\p{N}])(${rows.map((o) => escapeRx(o.term).replace(/\s+/g, "\\s+")).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  return text.replace(rx, (m) => map.get(m.toLowerCase().replace(/\s+/g, " ")) ?? m);
}

/**
 * The text the voice model should read for a script line (never shown to anyone), per engine:
 *   gemini      "Ucho" / "Ochu": Gemini reads "Uco" / "U-co" the Spanish / English way ("Uko")
 *   edge        "Uco" / "Ocu" as plain Indonesian words (c = /tʃ/). The hyphenated "U-co" made Edge's Indonesian
 *               voice read "co" as a separate token, "ko": the 1:19 outro of the "100 lamaran" episode ("kayak Uco",
 *               "follow @uco.ocu") was an Edge line and said "Uko"
 *   elevenlabs  "U-co": split so it isn't slurred into "Ucu"
 * Every occurrence is a whole word ("kayak Uco" too, not "Ucok").
 */
export function ttsText(text: string, voice: "gemini" | "edge" | "elevenlabs" = "elevenlabs", overrides: readonly PronunciationOverride[] = []): string {
  let out = applyOverrides(text, overrides).replace(ACRONYM_RX, (m) => ACRONYMS[m]);
  for (const [re, to] of RULES) out = out.replace(re, to);
  if (voice === "gemini") out = out.replace(/\bU-co\b/g, "Ucho").replace(/\bOcu\b/gi, "Ochu");
  if (voice === "edge") out = out.replace(/\bU-co\b/g, "Uco");
  return out.replace(/\s{2,}/g, " ").trim();
}

/** The handle written properly ("@uco.ocu") wherever a script or subtitle spelled it out ("uco titik ocu", "uco dot ocu"). */
export function cleanHandle(text: string): string;
export function cleanHandle(text: string | null | undefined): string | null | undefined;
export function cleanHandle(text: string | null | undefined) {
  return text == null ? text : text.replace(HANDLE_SPELLINGS, "@uco.ocu");
}
