// Manual / Exact Import: turns a pasted Uco & Ocu script (plus optional direction and cue notes) into the app's
// script lines with fixed rules. Pure TypeScript: no AI SDKs, no network, no server-only imports, so the browser
// (Parse Script) and the server give the same result for the same text, and the tests can run it directly.
//
// EXACT IMPORT: the Indonesian dialogue and the [EN] subtitles are kept character for character. The parser only
// removes the quote marks that wrap a line ("…" / “…”) and the whitespace around it; it never edits the words.
//
// Full format (every part optional except the dialogue lines):
//   Title: Bubur Diaduk vs Nggak Diaduk
//   Target Runtime: 60s                          (or 1:00)
//   [Beat: Hook]                                  beat for the lines that follow
//   1. UCO (0:00–0:05 | loud, Dutch tilt): "Dengerin! Bubur nggak diaduk itu kriminal!"
//   [EN] "Listen up! Not stirring your porridge is a crime!"
//   11. UCO (thought) (0:58–1:03 | soft): "Dia ada benernya…"
//   DIRECTION & VISUAL NOTES                      pacing / BGM / CTA notes (video/src/direction.ts) and visual notes
//   - Pause 0.3s between lines
//   LINE-BY-LINE VISUAL, ON-SCREEN TEXT & SFX CUES
//   - Line 1 (Uco): Dutch tilt, phone feed of packed cafes. SFX: record scratch · on screen: "KRIMINAL!"
//   - Line 6 (Ocu): layout: takeover · prop: peta-banjir · stat: "20 KM | MATI DALAM 2 HARI"
//     (Evidence Takeover: the prop / stat card centre stage, the speaker in a corner cameo; "takeover: true" works too.
//      Quote the stat so its "|" isn't read as a cue separator.)
// Simple format: "UCO: …" / "OCU: …" rows, with cue rows under a line (SFX:, PROP:, POSE:, SHOT:, TEXT:, …).

import { CAMERA_SHOTS, EMOTIONS, OVERLAYS } from "../../video/src/beats";
import { parseDirection, type RenderDirection } from "../../video/src/direction";
import { BEATS, EXPRESSIONS } from "./script-parse";

export type ManualLine = {
  beat: (typeof BEATS)[number];
  speaker: "uco" | "ocu";
  /** the Indonesian line, exactly as pasted */
  text: string;
  /** the [EN] subtitle, exactly as pasted ("" when there's none) */
  subtitle: string;
  expression: (typeof EXPRESSIONS)[number];
  thought_bubble: boolean;
  visual: string;
  /** short on-screen text from the cues ("on screen: …") */
  on_screen_text: string | null;
  /** the same text as the floating 2–4 word kinetic callout on this line (editable in the beat table) */
  kinetic_text: string | null;
  /** delivery notes from the line header ("loud, Dutch tilt") */
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
  /** "takeover" (Evidence Takeover) or "standard" */
  layout: "standard" | "takeover";
  /** Evidence Takeover data callout "HEADLINE | SUBLINE", or null */
  stat: string | null;
};

export type ManualScript = {
  title: string;
  /** "Target Runtime:" in seconds, or null */
  targetRuntimeS: number | null;
  lines: ManualLine[];
  /** the direction notes that apply (the DIRECTION block plus the separate direction box), as text */
  directionText: string;
  direction: RenderDirection;
  warnings: string[];
};

/** Poses each character has sprites for (the Pose dropdown offers only these). */
export const POSES: Record<"uco" | "ocu", readonly string[]> = {
  // angry: drawn once and uploaded in Accounts → Studio Assets; until then it renders as shocked / defensive
  uco: ["triumphant", "defensive", "shocked", "phone", "angry"],
  ocu: ["deadpan", "explaining", "inspecting", "cta", "angry"],
};

// ------------------------------------------------------------------ small helpers
const TIME = /^(\d{1,2}):(\d{2})(?:[.,](\d{1,2}))?$/;
const RANGE = /^(\d{1,2}:\d{2}(?:[.,]\d{1,2})?)\s*(?:[–—-]|to|sampai|s\/d)\s*(\d{1,2}:\d{2}(?:[.,]\d{1,2})?)$/i;
const THOUGHT = /^(thought|inner thought|inner monologue|dalam hati|batin|💭)$/i;
const QUOTE_PAIRS: [string, string][] = [
  ['"', '"'],
  ["“", "”"],
  ["„", "“"],
  ["«", "»"],
  ["”", "”"],
];

/** "1:05" / "0:24.5" → seconds. */
export function clockToSeconds(t: string): number | null {
  const m = TIME.exec(t.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0);
}
export const secondsToClock = (s: number) => {
  const whole = Math.floor(s % 60);
  const frac = Math.round((s % 1) * 10) / 10;
  return frac ? `${Math.floor(s / 60)}:${(whole + frac).toFixed(1).padStart(4, "0")}` : `${Math.floor(s / 60)}:${String(whole).padStart(2, "0")}`;
};

/** Spoken length without a recording or end time: ~2.6 Indonesian words a second, at least 1.5 s. */
export function spokenSeconds(text: string) {
  return Math.max(1.5, text.split(/\s+/).filter(Boolean).length / 2.6 + 0.4);
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** The text inside the quotes that wrap `s` (verbatim), and anything after the closing quote; or `s` itself. */
function unwrapQuoted(s: string): { text: string; after: string } {
  const t = s.trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (!t.startsWith(open)) continue;
    const end = t.lastIndexOf(close);
    if (end > 0) return { text: t.slice(open.length, end), after: t.slice(end + close.length).trim() };
  }
  return { text: t, after: "" };
}

/** "60s", "60 sec", "1:00", "1 min", "90 detik" → seconds. */
function runtime(s: string): number | null {
  const clock = clockToSeconds(s.trim().split(/\s+/)[0] ?? "");
  if (clock !== null) return clock;
  const m = /(\d+(?:[.,]\d+)?)\s*(m|min|mins|minutes?|menit|s|sec|secs|seconds?|detik)?\b/i.exec(s);
  if (!m) return null;
  const v = parseFloat(m[1].replace(",", "."));
  return /^m/i.test(m[2] ?? "") ? v * 60 : v;
}

const BEAT_ALIASES: Record<string, (typeof BEATS)[number]> = {
  hook: "hook", intro: "hook", opening: "hook", opener: "hook",
  counter: "counter", setup: "counter", "set-up": "counter", conflict: "counter",
  escalation: "escalation", escalate: "escalation", build: "escalation", argument: "escalation",
  insight: "insight", twist: "insight", reveal: "insight", fact: "insight", science: "insight",
  concession: "concession", thought: "concession", "inner thought": "concession",
  button: "button", punchline: "button", ending: "button", outro: "button", cta: "button", payoff: "button",
};
const beatAlias = (s: string | null | undefined) => {
  const k = (s ?? "").toLowerCase().replace(/^(beat|act|part|scene)\s*\d*\s*[:.—–-]?\s*/, "").trim();
  return BEAT_ALIASES[k] ?? BEAT_ALIASES[k.split(/[\s:—–(/-]+/)[0]] ?? null;
};

const SHOT_ALIASES: Record<string, string> = {
  "close-up": "closeup-punch", closeup: "closeup-punch", "close up": "closeup-punch", punch: "closeup-punch", cu: "closeup-punch", "closeup-punch": "closeup-punch",
  "two-shot": "two-shot", "two shot": "two-shot", both: "two-shot", berdua: "two-shot", "2-shot": "two-shot",
  solo: "solo", single: "solo", "solo-uco": "solo-uco", "solo-ocu": "solo-ocu",
};
const OVERLAY_ALIASES: Record<string, string> = {
  brain: "brain-badge", otak: "brain-badge", psikologi: "brain-badge", psychology: "brain-badge", "brain-badge": "brain-badge",
  wave: "wave-graph", graph: "wave-graph", grafik: "wave-graph", emulsi: "wave-graph", emulsion: "wave-graph", "wave-graph": "wave-graph",
  none: "none", off: "none",
};

// ------------------------------------------------------------------ cue segments ("SFX: ding", "on screen: …", notes)
type Cues = {
  sfx: string[];
  prop: string | null;
  shot: string | null;
  pose: string | null;
  text: string | null;
  stamp: string | null;
  callouts: string[] | null;
  overlay: string | null;
  beat: string | null;
  visual: string[];
  start: number | null;
  end: number | null;
  layout: "standard" | "takeover" | null;
  stat: string | null;
  angry: boolean;
};
const emptyCues = (): Cues => ({ sfx: [], prop: null, shot: null, pose: null, text: null, stamp: null, callouts: null, overlay: null, beat: null, visual: [], start: null, end: null, layout: null, stat: null, angry: false });
const CUE = /^(sfx|sound|bunyi|prop|shot|camera|kamera|pose|emotion|emosi|ekspresi|on[- ]?screen(?: text)?|text|teks|stamp|callouts?|labels?|overlay|card|visual|beat|layout|takeover|stat)\s*[:=]\s*(.+)$/i;
/** pose words that mean an angry, urgent delivery: the angry pose (Studio Assets) and an angry expression */
const ANGRY = /^(angry|marah|furious|murka|urgent)$/;

/** Reads one cue segment into `c`; returns false when it isn't a recognised cue (then it's a visual note). */
function readCue(seg: string, c: Cues): boolean {
  const part = seg.trim().replace(/[.;]$/, "");
  if (!part) return true;
  const range = RANGE.exec(part);
  if (range) {
    c.start = clockToSeconds(range[1]);
    c.end = clockToSeconds(range[2]);
    return true;
  }
  if (TIME.test(part)) {
    c.start = clockToSeconds(part);
    return true;
  }
  if (THOUGHT.test(part)) return true;
  const kv = CUE.exec(part);
  if (!kv) {
    if (beatAlias(part) && part.split(/\s+/).length <= 2) {
      c.beat = part;
      return true;
    }
    return false;
  }
  const key = kv[1].toLowerCase();
  const val = kv[2].trim();
  if (/^(sfx|sound|bunyi)$/.test(key)) c.sfx.push(...val.split(/\s*(?:[,+&/]|\band\b|\bdan\b)\s*/).map(slug).filter(Boolean));
  else if (key === "prop") c.prop = slug(unwrapQuoted(val).text) || null;
  else if (/^(shot|camera|kamera)$/.test(key)) c.shot = val.toLowerCase();
  else if (/^(pose|emotion|emosi|ekspresi)$/.test(key)) c.pose = val.toLowerCase();
  else if (/^(on[- ]?screen|text|teks)/.test(key)) c.text = unwrapQuoted(val).text.trim();
  else if (key === "stamp") c.stamp = unwrapQuoted(val).text.trim();
  else if (/^(callouts?|labels?)$/.test(key)) c.callouts = val.split(/\s*[,+&/]\s*/).map(slug).filter(Boolean);
  else if (/^(overlay|card)$/.test(key)) c.overlay = val.toLowerCase();
  else if (key === "visual") c.visual.push(val);
  else if (key === "layout") c.layout = /^takeover|evidence/i.test(val) ? "takeover" : "standard";
  else if (key === "takeover") c.layout = /^(true|yes|ya|on|1)$/i.test(val.trim()) ? "takeover" : "standard";
  else if (key === "stat") c.stat = unwrapQuoted(val).text.trim() || null;
  else if (key === "beat") c.beat = val;
  return true;
}

/** Splits a cue string on "|", "·", "•" and on " SFX:" / " on screen:" mid-sentence, then reads each segment. */
function readCues(s: string, c: Cues) {
  // a quoted stat keeps its own "|" ("stat: \"20 KM | MATI DALAM 2 HARI\""): read it before splitting the rest
  const rest = s.replace(/\bstat\s*[:=]\s*(["“])([^"”]*)["”]/i, (_, _q: string, v: string) => {
    c.stat = v.trim() || null;
    return "";
  });
  const segments = rest
    .replace(/\s+(?=(?:sfx|sound|prop|pose|shot|on[- ]?screen(?: text)?|stamp|callouts?|overlay|card|layout|takeover|stat)\s*[:=])/gi, " · ")
    .split(/\s*[|·•]\s*/);
  for (const seg of segments) if (!readCue(seg, c)) c.visual.push(seg.trim().replace(/[.;]$/, ""));
}

// ------------------------------------------------------------------ the parser
const SECTION_DIRECTION = /^#*\s*\**\s*(direction|directions|arahan|visual notes|direction (&|and) visual notes)\b[^:]*:?\s*\**\s*$/i;
const SECTION_CUES = /^#*\s*\**\s*line[- ]by[- ]line\b.*$/i;
const SECTION_OTHER = /^#*\s*\**\s*(notes|catatan|captions?|hashtags|sources|references|script|naskah|dialogue|dialog)\b[^:]*:?\s*\**\s*$/i;
const DIALOGUE = /^(?:(\d{1,3})\s*[.)\]:-]\s*)?(?:\*\*)?\s*(UCO|OCU)\b(?:\*\*)?\s*(.*)$/i;
const EN = /^\s*(?:\[\s*EN\s*\]|EN\s*:|\(\s*EN\s*\)|English\s*:)\s*/i;
const LINE_CUE = /^[-*•]?\s*line\s*(\d{1,3})\s*(?:\(([^)]*)\))?\s*[:：—–-]\s*(.*)$/i;

type Raw = { n: number | null; speaker: "uco" | "ocu"; text: string; en: string | null; thought: boolean; cues: Cues; beat: string | null; delivery: string[]; poseHints: string[] };

export function parseManualScript(input: { topic?: string; script: string; direction?: string }): ManualScript {
  const warnings: string[] = [];
  const raws: Raw[] = [];
  const directionRows: string[] = [];
  const lineCues: { n: number; speaker: string | null; body: string }[] = [];
  const meta: { title: string | null; runtime: number | null } = { title: null, runtime: null };
  let beat: string | null = null;
  let section: "script" | "direction" | "cues" | "other" = "script";

  const all = `${input.script ?? ""}\n${input.direction ?? ""}`.replace(/\r/g, "").split("\n");
  // rows of the separate direction box are direction notes unless they're inside a cue block
  const directionBoxStart = (input.script ?? "").replace(/\r/g, "").split("\n").length;

  all.forEach((rawRow, rowIndex) => {
    const row = rawRow.trim();
    if (rowIndex === directionBoxStart) section = "direction"; // the separate direction / cues box starts here
    if (!row || /^[-=_*]{3,}$/.test(row)) return;

    // section headers
    if (SECTION_CUES.test(row)) return void (section = "cues");
    if (SECTION_DIRECTION.test(row)) return void (section = "direction");
    if (SECTION_OTHER.test(row) && !DIALOGUE.test(row)) return void (section = /script|naskah|dialog/i.test(row) ? "script" : "other");

    // metadata
    const metaRow = /^(title|judul|topic|topik)\s*:\s*(.+)$/i.exec(row);
    if (metaRow && !meta.title) return void (meta.title = unwrapQuoted(metaRow[2]).text.trim());
    const rt = /^(target\s*runtime|runtime|durasi|duration)\s*:\s*(.+)$/i.exec(row);
    if (rt) return void (meta.runtime = runtime(rt[2]));
    const beatMark = /^\[\s*beat\s*[:=-]\s*([^\]]+)\]$/i.exec(row) ?? /^#{1,4}\s*beat\s*[:=-]?\s*(.+)$/i.exec(row);
    if (beatMark) {
      beat = beatMark[1].trim();
      section = "script";
      return;
    }

    // line-by-line cue rows ("- Line 4 (Ocu): …"): anywhere, but expected in the cue block
    const lc = LINE_CUE.exec(row);
    if (lc && (section === "cues" || section === "direction" || !DIALOGUE.test(row))) {
      lineCues.push({ n: Number(lc[1]), speaker: lc[2]?.trim() ?? null, body: lc[3] });
      return;
    }
    if (section === "cues") {
      // a continuation row of the previous line cue
      if (lineCues.length) lineCues[lineCues.length - 1].body += ` · ${row.replace(/^[-*•]\s*/, "")}`;
      return;
    }
    if (section === "direction") {
      directionRows.push(row.replace(/^[-*•]\s*/, ""));
      return;
    }
    if (section === "other") return;

    // [EN] for the line above (the next non-empty row)
    if (EN.test(row)) {
      const last = raws[raws.length - 1];
      if (!last) return;
      const en = unwrapQuoted(row.replace(EN, "")).text.trim();
      last.en = last.en ? `${last.en} ${en}` : en;
      return;
    }

    const m = DIALOGUE.exec(row);
    if (m) {
      const speaker = m[2].toLowerCase() as "uco" | "ocu";
      let rest = m[3];
      const cues = emptyCues();
      let thought = false;
      const delivery: string[] = [];
      // bracket groups and labels before the colon: (thought) (0:58–1:03 | soft) [whispers] Inner Thought
      for (;;) {
        const g = /^\s*(?:\(([^()]*)\)|\[([^\]]*)\])/.exec(rest);
        if (!g) break;
        const inner = (g[1] ?? g[2] ?? "").trim();
        rest = rest.slice(g[0].length);
        if (THOUGHT.test(inner)) {
          thought = true;
          continue;
        }
        const parts = inner.split(/\s*\|\s*/);
        for (const p of parts) {
          if (THOUGHT.test(p)) thought = true;
          else if (!readCue(p, cues)) delivery.push(p);
        }
      }
      const label = /^\s*([A-Za-z][\w '’-]{0,30}?)\s*(?=[:：])/.exec(rest);
      if (label) {
        if (/thought|batin|dalam hati|inner/i.test(label[1])) thought = true;
        else delivery.push(label[1].trim());
        rest = rest.slice(label[0].length);
      }
      const sep = /^\s*(?:[:：|]|[–—-](?!\d))\s*/.exec(rest);
      if (!sep) {
        // "UCO" alone (a heading, a cast list) is not a line
        if (!rest.trim()) return;
      } else rest = rest.slice(sep[0].length);
      // inline [EN] on the same row
      let en: string | null = null;
      const enAt = rest.search(/\[\s*EN\s*\]/i);
      if (enAt >= 0) {
        en = unwrapQuoted(rest.slice(enAt).replace(EN, "")).text.trim();
        rest = rest.slice(0, enAt);
      }
      const { text, after } = unwrapQuoted(rest);
      if (after) readCues(after.replace(/^[([]|[)\]]$/g, ""), cues);
      if (!text.trim()) return;
      raws.push({ n: m[1] ? Number(m[1]) : null, speaker, text: text.trim(), en, thought, cues, beat, delivery, poseHints: [] });
      beat = null; // a [Beat] marker names the beat of the line under it; following lines keep it below
      return;
    }

    // cue rows under a line ("SFX: ding", "[PROP: bubur-mixed]", "on screen: …")
    const last = raws[raws.length - 1];
    const bare = row.replace(/^[[(]\s*|\s*[\])]$/g, "").replace(/^[-*•]\s*/, "");
    if (last && CUE.test(bare)) {
      readCues(bare, last.cues);
      return;
    }
    // anything else (notes, tables) is ignored
  });

  // the [Beat: …] marker carries over to the lines after it until the next marker
  let carried: string | null = null;
  for (const r of raws) {
    if (r.beat) carried = r.beat;
    else r.beat = carried;
  }

  // line-by-line cues: by line number when the script is numbered, else by position
  for (const lc of lineCues) {
    const target = raws.find((r) => r.n === lc.n) ?? (raws.some((r) => r.n !== null) ? undefined : raws[lc.n - 1]);
    if (!target) {
      warnings.push(`Cue for line ${lc.n}: there is no line ${lc.n}.`);
      continue;
    }
    if (lc.speaker && !new RegExp(target.speaker, "i").test(lc.speaker)) warnings.push(`Cue for line ${lc.n} says ${lc.speaker}, but line ${lc.n} is ${target.speaker === "uco" ? "Uco" : "Ocu"}.`);
    if (lc.speaker && /thought|batin/i.test(lc.speaker)) target.thought = true;
    if (lc.speaker) target.poseHints.push(lc.speaker); // "- Line 4 (Uco, triumphant): …"
    readCues(lc.body, target.cues);
  }

  if (!raws.length) warnings.push('No dialogue found. Start each line with "UCO:" or "OCU:" (numbers and timestamps are optional).');

  const n = raws.length;
  const lines: ManualLine[] = raws.map((r, i) => {
    const c = r.cues;
    const line: ManualLine = {
      beat: "counter",
      speaker: r.speaker,
      text: r.text,
      subtitle: r.en ?? "",
      expression: "neutral",
      thought_bubble: r.thought,
      visual: c.visual.filter(Boolean).join("; "),
      on_screen_text: c.text || null,
      kinetic_text: (c.text || c.stamp || "").replace(/["“”„«»]/g, "").trim() || null,
      delivery: r.delivery.length ? r.delivery.join(", ") : null,
      important_message: null,
      camera_shot: null,
      emotion: null,
      prop_tag: c.prop,
      start_s: c.start,
      end_s: c.end,
      sfx: [...new Set(c.sfx)].slice(0, 4),
      overlay: null,
      callouts: c.callouts,
      layout: c.layout ?? "standard",
      stat: c.stat,
    };
    // beat: explicit marker, else position and wording
    line.beat = beatAlias(c.beat) ?? beatAlias(r.beat) ?? positionalBeat(i, n, `${r.text} ${r.en ?? ""}`, r.thought);
    line.expression = expressionFor(r.speaker, r.text, r.thought);
    if (c.shot) {
      const v = SHOT_ALIASES[c.shot] ?? c.shot;
      if (v === "solo") line.camera_shot = `solo-${r.speaker}`;
      else if ((CAMERA_SHOTS as readonly string[]).includes(v) && v !== "cta-stinger") line.camera_shot = v;
      else warnings.push(`Line ${i + 1}: unknown shot "${c.shot}" (use solo, closeup or two-shot).`);
    }
    if (!c.pose) {
      // a pose word written in the line's notes ("0:13–0:18 | triumphant", "Line 4 (Uco, triumphant)", "deadpan stare")
      // counts as the pose; "cta" and "phone" only when they're the whole note, since they're also ordinary words
      const notes = [...r.poseHints, ...r.delivery, ...c.visual].map((x) => x.toLowerCase());
      const hit = POSES[r.speaker].find((p) =>
        p === "cta" || p === "phone" ? notes.some((n) => n.replace(/^(uco|ocu)\s*,\s*/, "").trim() === p) : notes.some((n) => new RegExp(`\\b${p}\\b`).test(n)),
      );
      if (hit) line.emotion = hit;
    }
    // an angry / urgent delivery ("pose: angry", "(Uco, angry)", "marah" in the notes): the angry pose, plus the
    // shake and red edge at render
    const notesLow = [...r.poseHints, ...r.delivery].map((x) => x.toLowerCase());
    const angryNote = notesLow.some((n) => /\b(angry|marah|furious|murka)\b/.test(n));
    if ((c.pose && ANGRY.test(c.pose)) || angryNote) line.expression = "angry";
    if (c.pose && ANGRY.test(c.pose)) line.emotion = "angry";
    else if (!c.pose && angryNote && !line.emotion) line.emotion = "angry";
    else if (c.pose) {
      if (POSES[r.speaker].includes(c.pose)) line.emotion = c.pose;
      else if ((EMOTIONS as readonly string[]).includes(c.pose)) warnings.push(`Line ${i + 1}: ${r.speaker === "uco" ? "Uco" : "Ocu"} has no "${c.pose}" pose (${POSES[r.speaker].join(", ")}).`);
      else warnings.push(`Line ${i + 1}: unknown pose "${c.pose}".`);
    }
    if (c.overlay) {
      const v = OVERLAY_ALIASES[c.overlay] ?? c.overlay;
      if (v === "none" || (OVERLAYS as readonly string[]).includes(v)) line.overlay = v;
      else warnings.push(`Line ${i + 1}: unknown card "${c.overlay}" (use brain, wave or none).`);
    }
    if (c.text || c.stamp) {
      const words = (s: string, k: number) => s.replace(/["“”]/g, "").trim().split(/\s+/).slice(0, k).join(" ").toUpperCase();
      line.important_message = { kicker: words(line.beat, 2), headline: words(c.text ?? c.stamp ?? "", 5), stamp: c.stamp ? words(c.stamp, 3) : null };
      if (c.text && c.text.split(/\s+/).length > 4) warnings.push(`Line ${i + 1}: on-screen text "${c.text}" is over 4 words; only the first 4 show.`);
    }
    if (line.layout === "takeover" && !line.prop_tag && !line.stat && !line.kinetic_text) warnings.push(`Line ${i + 1}: an Evidence Takeover needs a prop, a stat or on-screen text; it shows as a normal shot.`);
    if (!line.subtitle) warnings.push(`Line ${i + 1} has no [EN] subtitle; it will show none.`);
    return line;
  });

  // timestamps: forward only, end after start
  let last = -1;
  lines.forEach((l, i) => {
    if (l.end_s !== null && l.start_s !== null && l.end_s <= l.start_s) {
      warnings.push(`Line ${i + 1}: the end time is before the start; using the spoken length instead.`);
      l.end_s = null;
    }
    if (l.start_s === null) return;
    if (l.start_s < last) warnings.push(`Line ${i + 1} starts at ${secondsToClock(l.start_s)}, before line ${i}; it will start right after it instead.`);
    last = Math.max(last, l.start_s);
  });

  const directionText = [directionRows.join("\n")].filter(Boolean).join("\n").trim();
  return {
    title: (input.topic ?? "").trim().slice(0, 120) || meta.title?.slice(0, 120) || lines[0]?.text.slice(0, 60) || "Custom episode",
    targetRuntimeS: meta.runtime,
    lines,
    directionText,
    direction: parseDirection(directionText),
    warnings,
  };
}

function positionalBeat(i: number, n: number, text: string, thought: boolean): ManualLine["beat"] {
  if (i === 0) return "hook";
  if (i === n - 1 && n > 2) return "button";
  if (thought) return "concession";
  if (/\b(jadi|artinya|faktanya|ternyata|sebenarnya|secara ilmiah|so|actually|turns out|in fact)\b/i.test(text)) return "insight";
  return i <= 2 ? "counter" : "escalation";
}

function expressionFor(speaker: "uco" | "ocu", text: string, thought: boolean): ManualLine["expression"] {
  if (thought) return "thinking";
  if (/\?!|!\?|!!/.test(text) || /\b(hah|waduh|astaga|serius|loh|lho)\b/i.test(text)) return "shocked";
  if (/!/.test(text)) return speaker === "uco" ? "excited" : "smug";
  if (/\?/.test(text)) return speaker === "uco" ? "worried" : "calm";
  return speaker === "uco" ? "neutral" : "deadpan";
}

/** Estimated length of the episode (s): timestamps where given, spoken length elsewhere, plus the end card. */
export function estimatedRuntime(lines: Pick<ManualLine, "text" | "start_s" | "end_s">[], cta = true) {
  let t = 0;
  for (const l of lines) {
    const len = l.start_s !== null && l.end_s !== null && l.end_s > l.start_s ? l.end_s - l.start_s : spokenSeconds(l.text);
    t = Math.max(t, l.start_s ?? t) + len + 0.2;
  }
  return Math.round((t + (cta ? 3 : 0)) * 10) / 10;
}
