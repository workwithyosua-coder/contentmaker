// Render direction: pacing, background music and outro settings for one episode, read from the user's plain-text
// direction notes by fixed rules (no AI). Shared by the app (Beat Inspector, asset checklist) and the renderer.
//
// Recognised notes (one per line or sentence, English or Indonesian, case-insensitive):
//   pause: 0.4s | jeda 0.4 detik | breath 300ms      gap between lines (default: the tight comedic timing)
//   thought pause: 0.6s                             extra breath around (thought) lines
//   bgm: on | music on | pakai musik                background music bed (needs sfx/bgm.mp3)
//   pacing: natural                                 dialogue-aware gaps between lines (see naturalGap)
//   bgm: urgent                                     the urgent track (sfx/bgm-urgent.mp3, else the regular bed)
//   bgm volume: 15%                                 bed level (default 8%)
//   duck bgm on thought | bgm off on thought        music under inner thoughts: −12 dB (the default) or silent
//   cta: off | no outro | tanpa cta                 drop the closing Follow stinger
//   cta: Follow buat part 2                         CTA stamp text (first 4 words)

export type RenderDirection = {
  /** gap between lines in seconds; null = the default comedic timing */
  pauseS: number | null;
  /** gap before and after (thought) lines in seconds; null = default */
  thoughtPauseS: number | null;
  /**
   * "Pacing: natural": gaps between lines follow the dialogue (0.30 s on a speaker switch, 0.24 s for the same speaker,
   * 0.42 s into a takeover, a thought, the final punchline or the outro) instead of one flat pause
   */
  naturalPacing?: boolean;
  bgm: boolean;
  /** "BGM: urgent": the urgent track (bgm-urgent) whatever the lines' poses, falling back to the regular bed */
  urgentBgm?: boolean;
  /** music bed level 0..1 */
  bgmVolume: number;
  /** music level under (thought) lines, as a fraction of the bed (0 = silent) */
  thoughtDuck: number;
  /** closing Follow stinger */
  cta: boolean;
  /** custom CTA stamp (≤ 4 words), or null for the default */
  ctaText: string | null;
  /** the notes ask for the outro themselves ("CTA: on", "CTA: Follow buat part 2"), not just the default */
  ctaExplicit?: boolean;
  /** the notes as written */
  notes: string;
  /**
   * Exact (Manual / Exact Import) scripts: show only what the script asks for: no keyword-guessed props, cards or
   * prop labels. Set by the app / renderer from the script, not from the notes.
   */
  exact?: boolean;
};

// thoughtDuck 0.25 ≈ −12 dB: inner thoughts always sound like a different room (the music dips, with a short fade)
export const DEFAULT_DIRECTION: RenderDirection = { pauseS: null, thoughtPauseS: null, bgm: false, bgmVolume: 0.08, thoughtDuck: 0.25, cta: true, ctaText: null, notes: "" };

/** "0.4s", "400ms", "0,4 detik", "1 sec" → seconds (clamped to 0..3). */
function seconds(s: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(ms|milliseconds?|s|sec|secs|seconds?|detik|dtk)?\b/i.exec(s);
  if (!m) return null;
  const v = parseFloat(m[1].replace(",", "."));
  const unit = (m[2] ?? "s").toLowerCase();
  const sec = unit.startsWith("ms") || unit.startsWith("milli") ? v / 1000 : v;
  return Number.isFinite(sec) ? Math.min(3, Math.max(0, Math.round(sec * 100) / 100)) : null;
}

const OFF = /\b(off|no|none|nggak|gak|tidak|tanpa|mati|false|0)\b/i;

/** The pacing notes only: the stored line-by-line cue block ("- Line 4 (Ocu): pose: cta …") is not direction. */
export function stripCueBlock(text: string): string {
  const out: string[] = [];
  let inCues = false;
  for (const row of text.replace(/\r/g, "").split("\n")) {
    const t = row.trim();
    if (/^#*\s*\**\s*line[- ]by[- ]line\b/i.test(t)) {
      inCues = true;
      continue;
    }
    if (inCues && /^#*\s*\**\s*(direction|directions|arahan|visual notes|notes|catatan)\b[^:]*:?\s*\**\s*$/i.test(t)) inCues = false;
    if (inCues || /^[-*•]?\s*line\s*\d{1,3}\b/i.test(t)) continue;
    out.push(row);
  }
  return out.join("\n");
}

export function parseDirection(text: string | null | undefined): RenderDirection {
  const notes = (text ?? "").trim();
  const d: RenderDirection = { ...DEFAULT_DIRECTION, notes };
  for (const raw of stripCueBlock(notes).split(/\n|;|(?<=\.)\s+/)) {
    const line = raw.trim();
    if (!line) continue;
    const low = line.toLowerCase();
    if (/\b(thought|batin|dalam hati)\b/.test(low) && /\b(pause|jeda|breath|napas|gap)\b/.test(low)) {
      d.thoughtPauseS = seconds(line) ?? d.thoughtPauseS;
    } else if (/\bpacing\b/.test(low) && /\b(natural|alami|natural timing)\b/.test(low)) {
      d.naturalPacing = true;
    } else if (/\b(pause|jeda|breath|napas|gap)\b/.test(low)) {
      d.pauseS = seconds(line) ?? d.pauseS;
    }
    if (/\b(bgm|music|musik|backsound)\b/.test(low)) {
      if (/\b(duck|kecil|pelan|quiet|lower)\b/.test(low) && /\b(thought|batin|dalam hati)\b/.test(low)) {
        d.bgm = true;
        d.thoughtDuck = /\b(off|mute|silent|hilang|mati)\b/.test(low) ? 0 : 0.25;
      } else if (/\b(off|mute|silent|mati)\b/.test(low) && /\b(thought|batin|dalam hati)\b/.test(low)) {
        d.bgm = true;
        d.thoughtDuck = 0;
      } else if (/\b(volume|level|vol)\b/.test(low)) {
        const pct = /(\d+(?:[.,]\d+)?)\s*%/.exec(line);
        const v = pct ? parseFloat(pct[1].replace(",", ".")) / 100 : null;
        if (v !== null && Number.isFinite(v)) d.bgmVolume = Math.min(0.5, Math.max(0, v));
        d.bgm = true;
      } else {
        d.bgm = !OFF.test(low.replace(/\b(bgm|music|musik|backsound)\b/, ""));
        if (d.bgm && /\b(urgent|urgensi|tegang|darurat)\b/.test(low)) d.urgentBgm = true;
      }
    }
    if (/\b(cta|outro|follow stinger|end card)\b/.test(low)) {
      const rest = line.replace(/^.*?\b(cta|outro|end card)\b\s*[:=-]?\s*/i, "").trim();
      if (/\b(no|tanpa|without|skip|hapus|remove)\s+(the\s+)?(cta|outro|end card|follow stinger)\b/i.test(low)) d.cta = false;
      else if (!rest || /^(on|yes|ya|true)$/i.test(rest)) {
        d.cta = true;
        d.ctaExplicit = true;
      } else if (OFF.test(rest.split(/\s+/)[0]) || /^(no|tanpa)\b/i.test(low)) d.cta = false;
      else {
        d.ctaText = rest.replace(/["“”]/g, "").split(/\s+/).slice(0, 4).join(" ").toUpperCase();
        d.ctaExplicit = true;
      }
    }
  }
  return d;
}
