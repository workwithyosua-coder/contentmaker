// No-AI custom scripts: turns a user's own topic, pasted script and direction notes into Uco & Ocu script lines by
// fixed rules. Pure TypeScript (no AI SDKs, no network, no server-only imports), so the same input always gives the
// same lines, and the Beat Inspector can re-run it in the browser.
//
// Script format (anything else is ignored as notes):
//   UCO: Dengerin! Bubur nggak diaduk itu kriminal!          a line (also "OCU —", "**UCO**", "3. UCO (0:24–0:28): …")
//   [EN] Listen up! Not stirring porridge is a crime!          its English subtitle (next row, or inline)
//   OCU (thought): Dia ada benernya…                            inner thought ("(thought)", "dalam hati", "batin", 💭)
//   UCO (0:24–0:28 | hook | SFX: ding | PROP: bubur-unmixed): …  cues in brackets on the line
//   SFX: record-scratch     PROP: …     SHOT: closeup     POSE: shocked     TEXT: 3 LAPIS     STAMP: KRIMINAL
//   CALLOUT: ayam, cakwe    OVERLAY: brain     VISUAL: …       cue rows under a line apply to that line
// Timestamps "m:ss–m:ss" fix when a line starts (and, without a recording, how long it lasts); lines without them
// follow the episode's pacing.

import { CAMERA_SHOTS, EMOTIONS, OVERLAYS } from "../../video/src/beats";
import { parseDirection, type RenderDirection } from "../../video/src/direction";
import { pngPropByName } from "../../video/src/props/library";
import { BEATS, EN_LINE, EXPRESSIONS, SPEAKER, parsePastedScript } from "./script-parse";

export type CustomLine = {
  beat: (typeof BEATS)[number];
  speaker: "uco" | "ocu";
  text: string;
  subtitle: string;
  expression: (typeof EXPRESSIONS)[number];
  thought_bubble: boolean;
  visual: string;
  on_screen_text: string | null;
  delivery: string | null;
  important_message: { kicker: string; headline: string; stamp: string | null } | null;
  camera_shot: string | null;
  emotion: string | null;
  prop_tag: string | null;
  start_s: number | null;
  end_s: number | null;
  sfx: string[];
  overlay: string | null;
  callouts: string[] | null;
};

export type CustomScript = { title: string; lines: CustomLine[]; direction: RenderDirection; warnings: string[] };

const CUE_KEYS = /^(sfx|sound|bunyi|prop|shot|camera|kamera|pose|emotion|emosi|ekspresi|text|teks|on[- ]?screen|stamp|callouts?|label|overlay|card|visual|beat)\s*[:=]\s*(.+)$/i;
const TIME = /^(\d{1,2}):(\d{2})(?:[.,](\d{1,2}))?$/;
const RANGE = /^(\d{1,2}:\d{2}(?:[.,]\d{1,2})?)\s*(?:[–—-]|to|sampai|s\/d)\s*(\d{1,2}:\d{2}(?:[.,]\d{1,2})?)$/i;
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** "1:05" / "0:24.5" → seconds. */
export function clockToSeconds(t: string): number | null {
  const m = TIME.exec(t.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0);
}
export const secondsToClock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(s % 1 ? 1 : 0).padStart(s % 1 ? 4 : 2, "0")}`;

const SHOT_ALIASES: Record<string, string> = {
  "close-up": "closeup-punch", closeup: "closeup-punch", "close up": "closeup-punch", punch: "closeup-punch", cu: "closeup-punch",
  "two-shot": "two-shot", "two shot": "two-shot", both: "two-shot", berdua: "two-shot", "2-shot": "two-shot",
  solo: "solo", single: "solo",
};
const OVERLAY_ALIASES: Record<string, string> = {
  brain: "brain-badge", otak: "brain-badge", psikologi: "brain-badge", psychology: "brain-badge",
  wave: "wave-graph", graph: "wave-graph", grafik: "wave-graph", emulsi: "wave-graph", emulsion: "wave-graph",
  none: "none", off: "none",
};
const BEAT_ALIASES: Record<string, (typeof BEATS)[number]> = { punchline: "button", ending: "button", outro: "button", cta: "button", intro: "hook", opening: "hook" };

/**
 * Cue rows that sit under a line ("SFX: ding", "[PROP: bubur-mixed]") are folded into that line's speaker row as
 * bracketed cues, so the shared paste parser sees them as the line's own cues.
 */
function foldCueRows(script: string) {
  const out: string[] = [];
  let lastSpeaker = -1;
  for (const raw of script.replace(/\r/g, "").split("\n")) {
    const row = raw.trim();
    const bare = row.replace(/^[[(]\s*|\s*[\])]$/g, "");
    if (lastSpeaker >= 0 && CUE_KEYS.test(bare) && !SPEAKER.test(row) && !EN_LINE.test(row)) {
      const target = out[lastSpeaker];
      const at = target.search(/\[\s*EN\s*\]/i);
      const cue = ` [${bare.replace(/[[\]]/g, "")}]`;
      out[lastSpeaker] = at >= 0 ? `${target.slice(0, at)}${cue} ${target.slice(at)}` : `${target}${cue}`;
      continue;
    }
    if (SPEAKER.test(row)) lastSpeaker = out.length;
    out.push(raw);
  }
  return out.join("\n");
}

function expressionFor(speaker: "uco" | "ocu", text: string, thought: boolean): CustomLine["expression"] {
  if (thought) return "thinking";
  if (/\?!|!\?|!!/.test(text) || /\b(hah|waduh|astaga|serius|loh|lho)\b/i.test(text)) return "shocked";
  if (/!/.test(text)) return speaker === "uco" ? "excited" : "smug";
  if (/\?/.test(text)) return speaker === "uco" ? "worried" : "calm";
  return speaker === "uco" ? "neutral" : "deadpan";
}

function beatFor(i: number, n: number, text: string, thought: boolean, explicit: string | null): CustomLine["beat"] {
  const e = explicit?.toLowerCase().trim() ?? "";
  if ((BEATS as readonly string[]).includes(e)) return e as CustomLine["beat"];
  if (BEAT_ALIASES[e]) return BEAT_ALIASES[e];
  if (i === 0) return "hook";
  if (i === n - 1 && n > 2) return "button";
  if (thought) return "concession";
  if (/\b(jadi|artinya|faktanya|ternyata|sebenarnya|secara ilmiah|so|actually|turns out|in fact)\b/i.test(text)) return "insight";
  return i <= 2 ? "counter" : "escalation";
}

const capWords = (s: string, n: number) => s.replace(/["“”]/g, "").trim().split(/\s+/).slice(0, n).join(" ").toUpperCase();

/** Parses a custom script. Never throws on content; problems come back as `warnings`. */
export function parseCustomScript(input: { topic: string; script: string; direction: string }): CustomScript {
  const warnings: string[] = [];
  const direction = parseDirection(input.direction);
  const { lines: parsed } = parsePastedScript(foldCueRows(input.script));
  if (!parsed.length) warnings.push('No lines found. Start each line with "UCO:" or "OCU:".');
  const lines: CustomLine[] = parsed.map((p, i) => {
    const line: CustomLine = {
      beat: "counter",
      speaker: p.speaker,
      text: p.text,
      subtitle: p.en ?? "",
      expression: "neutral",
      thought_bubble: p.thought,
      visual: "",
      on_screen_text: null,
      delivery: null,
      important_message: null,
      camera_shot: null,
      emotion: null,
      prop_tag: null,
      start_s: null,
      end_s: null,
      sfx: [],
      overlay: null,
      callouts: null,
    };
    const visual: string[] = [];
    // a section header ("HOOK", "## Escalation") names the beat of the first line under it only
    const newHeading = p.heading && p.heading !== parsed[i - 1]?.heading;
    let beat: string | null = newHeading ? p.heading!.replace(/^(beat|act|part|scene)\s*\d*\s*[:.—–-]?\s*/i, "").split(/[\s:—–-]+/)[0] : null;
    let text: string | null = null;
    let stamp: string | null = null;
    for (const part of p.cues.flatMap((c) => c.split(/\s*\|\s*/)).map((c) => c.trim()).filter(Boolean)) {
      const range = RANGE.exec(part);
      if (range) {
        line.start_s = clockToSeconds(range[1]);
        line.end_s = clockToSeconds(range[2]);
        continue;
      }
      if (TIME.test(part)) {
        line.start_s = clockToSeconds(part);
        continue;
      }
      const kv = CUE_KEYS.exec(part);
      if (kv) {
        const key = kv[1].toLowerCase();
        const val = kv[2].trim();
        if (/^(sfx|sound|bunyi)$/.test(key)) line.sfx.push(...val.split(/[,+&]|\band\b/).map(slug).filter(Boolean));
        else if (key === "prop") line.prop_tag = slug(val) || null;
        else if (/^(shot|camera|kamera)$/.test(key)) {
          const v = SHOT_ALIASES[val.toLowerCase()] ?? val.toLowerCase();
          if (v === "solo") line.camera_shot = `solo-${p.speaker}`;
          else if ((CAMERA_SHOTS as readonly string[]).includes(v) && v !== "cta-stinger") line.camera_shot = v;
          else warnings.push(`Line ${i + 1}: unknown shot "${val}" (use solo, closeup or two-shot).`);
        } else if (/^(pose|emotion|emosi|ekspresi)$/.test(key)) {
          const v = val.toLowerCase();
          if ((EMOTIONS as readonly string[]).includes(v) && v !== "cta") line.emotion = v;
          else warnings.push(`Line ${i + 1}: unknown pose "${val}".`);
        } else if (/^(text|teks|on[- ]?screen)$/.test(key)) text = val;
        else if (key === "stamp") stamp = val;
        else if (/^(callouts?|label)$/.test(key)) line.callouts = val.split(/[,+&]/).map(slug).filter(Boolean);
        else if (/^(overlay|card)$/.test(key)) {
          const v = OVERLAY_ALIASES[val.toLowerCase()] ?? val.toLowerCase();
          if (v === "none" || (OVERLAYS as readonly string[]).includes(v)) line.overlay = v;
          else warnings.push(`Line ${i + 1}: unknown card "${val}" (use brain, wave or none).`);
        } else if (key === "visual") visual.push(val);
        else if (key === "beat") beat = val;
        continue;
      }
      if (/^(thought|inner thought|dalam hati|batin|💭)$/i.test(part)) continue;
      if ((BEATS as readonly string[]).includes(part.toLowerCase()) || BEAT_ALIASES[part.toLowerCase()]) {
        beat = part;
        continue;
      }
      visual.push(part); // stage directions ("Ocu holds up a blender", "loud") feed the prop and pose rules
    }
    line.visual = visual.join("; ");
    line.beat = beatFor(i, parsed.length, `${p.text} ${p.en ?? ""}`, p.thought, beat);
    line.expression = expressionFor(p.speaker, p.text, p.thought);
    if (text || stamp) {
      line.on_screen_text = text;
      line.important_message = { kicker: capWords(line.beat, 2), headline: capWords(text ?? stamp ?? "", 5), stamp: stamp ? capWords(stamp, 3) : null };
    }
    if (line.callouts && line.prop_tag && pngPropByName(line.prop_tag)) {
      const ids = new Set(pngPropByName(line.prop_tag)!.parts.map((x) => x.id));
      const bad = line.callouts.filter((c) => !ids.has(c));
      if (bad.length) warnings.push(`Line ${i + 1}: ${line.prop_tag} has no part "${bad.join('", "')}".`);
    }
    if (!line.subtitle) warnings.push(`Line ${i + 1} has no [EN] subtitle; it will show none.`);
    return line;
  });
  // timestamps must go forward
  let last = -1;
  lines.forEach((l, i) => {
    if (l.start_s === null) return;
    if (l.start_s < last) warnings.push(`Line ${i + 1} starts at ${secondsToClock(l.start_s)}, before line ${i}; it will start right after it instead.`);
    if (l.end_s !== null && l.end_s <= l.start_s) {
      warnings.push(`Line ${i + 1}: the end time is before the start; using the spoken length instead.`);
      l.end_s = null;
    }
    last = Math.max(last, l.start_s);
  });
  const title = input.topic.trim().slice(0, 120) || lines[0]?.text.slice(0, 60) || "Custom episode";
  return { title, lines, direction, warnings };
}

/** Spoken length when a line has no recording and no end time: ~2.6 Indonesian words per second, at least 1.5 s. */
export function spokenSeconds(text: string) {
  return Math.max(1.5, text.split(/\s+/).filter(Boolean).length / 2.6 + 0.4);
}
