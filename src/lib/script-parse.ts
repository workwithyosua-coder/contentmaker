// Pure, deterministic script parsing (no AI, no server-only imports): shared by the Claude-assisted import
// (script-import.ts) and the no-AI custom script studio (custom-script.ts).

export const BEATS = ["hook", "counter", "escalation", "insight", "concession", "button"] as const;
export const EXPRESSIONS = [
  "neutral", "excited", "angry", "furious", "smug", "calm", "worried", "deadpan", "thinking", "laughing", "shocked",
] as const;

export type ParsedLine = {
  speaker: "uco" | "ocu";
  text: string;
  en: string | null;
  cues: string[]; // timestamps, delivery and stage directions found around the line
  thought: boolean;
  heading: string | null; // the last section/beat header seen before this line ("HOOK", "Act 2", …)
};

export const SPEAKER = /^(?:[#\d]+[.)\]:-]?\s*)?(?:\*\*)?\s*(UCO|OCU)\b(?:\*\*)?/i;
export const EN_LINE = /^\s*(?:\[\s*EN\s*\]|EN\s*:|\(\s*EN\s*\)|English\s*:)\s*/i;
const THOUGHT = /\b(thought|inner\s*thought|in\s*his\s*head|dalam\s*hati|batin|💭)\b|💭/i;
const QUOTES = /^[\s"“”'‘’«»]+|[\s"“”'‘’«»]+$/g;

/** Splits one speaker line into the spoken words and its stage directions. */
function cleanSpoken(raw: string) {
  const cues: string[] = [];
  let s = raw;
  // [EN] written on the same line
  let en: string | null = null;
  const enAt = s.search(/\[\s*EN\s*\]/i);
  if (enAt >= 0) {
    en = s.slice(enAt).replace(EN_LINE, "").replace(QUOTES, "").trim() || null;
    s = s.slice(0, enAt);
  }
  // parentheticals and bracketed directions: (0:00–0:06 | Hook — loud), [whispers], *beat*
  s = s.replace(/\(([^()]*)\)|\[([^\]]*)\]|\*([^*]+)\*/g, (_m, a, b, c) => {
    const cue = (a ?? b ?? c ?? "").trim();
    if (cue) cues.push(cue);
    return " ";
  });
  // leading timestamps without brackets: 0:06 – 0:12 |
  s = s.replace(/^\s*\d{1,2}:\d{2}(?:\s*[–-]\s*\d{1,2}:\d{2})?\s*\|?/, (m) => {
    cues.push(m.replace(/\|$/, "").trim());
    return " ";
  });
  const text = s.replace(/\s+/g, " ").replace(QUOTES, "").trim();
  return { text, cues, en };
}

/**
 * Finds the spoken lines in a pasted script. Accepts numbered or unnumbered lines, `UCO:` / `OCU —` tags (also
 * `**UCO**`), cues before or after the tag, `(thought)` / `Inner Thought` markers, and `[EN]` lines under a line.
 * Everything else (beat headers, visual tables, notes) is kept as context for stage 2.
 */
export function parsePastedScript(input: string): { lines: ParsedLine[]; context: string[] } {
  const lines: ParsedLine[] = [];
  const context: string[] = [];
  let heading: string | null = null;
  // A speaker header with the words on the next row:  18. OCU (1:57–2:00 | Punchline):  ⏎  "Iya, sampai…"
  let pending: { speaker: "uco" | "ocu"; cues: string[]; thought: boolean; row: string } | null = null;
  for (const rawLine of input.replace(/\r/g, "").split("\n")) {
    const row = rawLine.trim();
    if (!row) continue;
    if (EN_LINE.test(row) && lines.length) {
      pending = null;
      const en = row.replace(EN_LINE, "").replace(QUOTES, "").trim();
      // one [EN] row for a shared line: [EN] UCO: "…" OCU: "…" → each speaker's own translation
      const parts = [...en.matchAll(/\b(UCO|OCU)\s*:\s*(.+?)(?=\s*\b(?:UCO|OCU)\s*:|$)/gi)];
      if (parts.length > 1) {
        const recent = lines.slice(-parts.length);
        if (recent.every((l, i) => l.speaker === parts[i][1].toLowerCase())) {
          recent.forEach((l, i) => (l.en = parts[i][2].replace(QUOTES, "").trim()));
          continue;
        }
      }
      const last = lines[lines.length - 1];
      last.en = last.en ? `${last.en} ${en}` : en;
      continue;
    }
    const m = SPEAKER.exec(row);
    if (!m && pending && !/^[\[(#]/.test(row)) {
      const { text, cues, en } = cleanSpoken(row);
      if (text) {
        context.pop(); // the header row was parked as context
        lines.push({ speaker: pending.speaker, text, en, cues: [...pending.cues, ...cues], thought: pending.thought, heading });
        pending = null;
        continue;
      }
    }
    pending = null;
    if (m) {
      let rest = row.slice(m[0].length);
      // cues between the tag and the colon: UCO (0:00–0:06 | Hook, loud): "…"
      const pre: string[] = [];
      rest = rest.replace(/^\s*((?:\([^)]*\)\s*|\[[^\]]*\]\s*)*)/, (all) => {
        all.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (_x, a, b) => {
          pre.push((a ?? b).trim());
          return "";
        });
        return "";
      });
      // a short label between the tag and the colon: "OCU Inner Thought: …", "UCO berbisik: …"
      const label = /^\s*([A-Za-z][\w '’-]{0,30}?)\s*(?=[:：|])/.exec(rest);
      if (label && !/^\s*[:：|]/.test(rest)) {
        pre.push(label[1].trim());
        rest = rest.slice(label[0].length);
      }
      // the separator after the tag: ":", "—", "-", "|"
      const sep = /^\s*(?:[:：|]|[–—-](?!\d))\s*/.exec(rest);
      if (!sep && !pre.length) {
        context.push(row); // e.g. "UCO & OCU" in a heading, not a line
        continue;
      }
      rest = sep ? rest.slice(sep[0].length) : rest;
      const { text, cues, en } = cleanSpoken(rest);
      if (!text) {
        // header only: the words should be on the next row
        const thought = THOUGHT.test(row) || pre.some((c) => THOUGHT.test(c));
        pending = { speaker: m[1].toLowerCase() as "uco" | "ocu", cues: [...pre, ...cues], thought, row };
        context.push(row);
        continue;
      }
      const allCues = [...pre, ...cues];
      lines.push({
        speaker: m[1].toLowerCase() as "uco" | "ocu",
        text,
        en,
        cues: allCues,
        thought: THOUGHT.test(row.slice(0, m.index + m[0].length + 40)) || allCues.some((c) => THOUGHT.test(c)),
        heading,
      });
      continue;
    }
    // section headers like "HOOK", "## Act 2 — Escalation", "BEAT 3: Insight"
    if (row.length < 60 && /^(#+\s*)?(act|beat|scene|part|hook|counter|escalation|insight|concession|punchline|button|ending|cta)\b/i.test(row)) {
      heading = row.replace(/^#+\s*/, "");
    }
    context.push(row);
  }
  return { lines, context };
}

/** Spoken length estimate: ~2.6 Indonesian words per second plus a short beat between lines. */
export function estimateSeconds(lines: { text: string }[]) {
  const words = lines.reduce((s, l) => s + l.text.split(/\s+/).filter(Boolean).length, 0);
  return Math.round(words / 2.6 + lines.length * 0.35);
}

export function formatDuration(s: number) {
  return s >= 90 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${s} s`;
}

