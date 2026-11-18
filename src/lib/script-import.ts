import "server-only";
import { z } from "zod";
import { structured } from "./agents/claude";
import { db } from "./db";
import { BEATS, EXPRESSIONS, type Script } from "./agents/writers-room";

// Importing a pre-written script. Two stages:
// 1. parsePastedScript(): plain code pulls out every spoken line (speaker, clean Indonesian, [EN], cues, thought flag).
//    In "exact" mode these Indonesian lines are what gets saved, word for word.
// 2. Claude maps each line onto the script schema: beat, expression, visual, on-screen text, delivery,
//    and an English subtitle only where the paste had none. In "adapt" mode it may also refine the dialogue
//    following the direction notes.

export type ImportMode = "exact" | "adapt";

export type ParsedLine = {
  speaker: "uco" | "ocu";
  text: string;
  en: string | null;
  cues: string[]; // timestamps, delivery and stage directions found around the line
  thought: boolean;
  heading: string | null; // the last section/beat header seen before this line ("HOOK", "Act 2", …)
};

const SPEAKER = /^(?:[#\d]+[.)\]:-]?\s*)?(?:\*\*)?\s*(UCO|OCU)\b(?:\*\*)?/i;
const EN_LINE = /^\s*(?:\[\s*EN\s*\]|EN\s*:|\(\s*EN\s*\)|English\s*:)\s*/i;
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

const MappedLine = z.object({
  beat: z.enum(BEATS),
  speaker: z.enum(["uco", "ocu"]),
  text: z.string().describe("The Indonesian spoken line. Exact mode: copy it unchanged from the input."),
  subtitle: z.string().describe("Natural English subtitle. Use the provided [EN] translation verbatim when there is one."),
  expression: z.enum(EXPRESSIONS),
  thought_bubble: z.boolean(),
  visual: z.string().describe("Short visual direction for this line: shot, action, props, SFX (one line)"),
  on_screen_text: z.string().nullable().describe("Short on-screen text only if the paste or notes ask for it, else null"),
  delivery: z.string().nullable().describe("How to say it: emotion, pace, emphasis"),
});
const ImportSchema = z.object({
  title: z.string().describe("Short episode title"),
  lines: z.array(MappedLine),
});

const BEAT_GUIDE = `Beats (in order, one or more lines each): hook (opening line(s) that frame the topic), counter (the other side's first reply),
escalation (the back-and-forth, usually the longest stretch), insight (the key fact or explanation),
concession (each privately admits the other has a point, usually inner thoughts), button (the closing punchline and any call to action).
Map act headers or section names in the paste onto these beats.`;

/** Stage 2: map parsed lines (or the raw paste) onto the script schema. */
export async function mapImportedScript(p: {
  projectId: string;
  mode: ImportMode;
  paste: string;
  notes: string;
  currentTitle: string | null;
}): Promise<{ script: Script; parsed: number; note: string }> {
  const { lines, context } = parsePastedScript(p.paste);
  // Numbered scripts ("18. OCU …") say how many lines to expect; stop rather than quietly save a shorter script.
  const numbered = new Set([...p.paste.matchAll(/^\s*(\d{1,3})[.)]\s*\**\s*(?:UCO|OCU)\b/gim)].map((m) => m[1])).size;
  if (numbered > lines.length) {
    throw new Error(
      `Only ${lines.length} of the ${numbered} numbered lines could be read. Put each line's words right after its speaker (UCO: "…") or on the row below the speaker header, then import again.`,
    );
  }
  const exact = p.mode === "exact";
  const parsedBlock = lines.length
    ? lines
        .map(
          (l, i) =>
            `${i + 1}. ${l.speaker.toUpperCase()}${l.thought ? " (inner thought)" : ""}: ${l.text}` +
            (l.en ? `\n   [EN] ${l.en}` : "") +
            (l.cues.length ? `\n   cues: ${l.cues.join(" | ")}` : "") +
            (l.heading ? `\n   section: ${l.heading}` : ""),
        )
        .join("\n")
    : "";

  const result = await structured({
    agent: "strategist",
    projectId: p.projectId,
    promptVersion: "script-import-v1",
    effort: "medium",
    system:
      "You format pre-written dialogue scripts for 'Uco & Ocu', an Indonesian animated banter series. Uco is loud and optimistic, " +
      "angry at stupidity; Ocu is calm, deadpan and pessimistic. You never invent facts.",
    schema: ImportSchema,
    prompt: `${
      lines.length
        ? `These ${lines.length} spoken lines were extracted from the creator's pasted script:\n<lines>\n${parsedBlock}\n</lines>\n\nOther text from the paste (headers, visual tables, notes):\n<context>\n${context.join("\n").slice(0, 8000)}\n</context>`
        : `The creator pasted this script (extract the spoken lines yourself; speaker tags may be missing or unusual):\n<paste>\n${p.paste.slice(0, 20000)}\n</paste>`
    }

Direction and visual notes from the creator:
<notes>
${p.notes || "(none)"}
</notes>

${
  exact
    ? `MODE: EXACT IMPORT. Return exactly ${lines.length || "one entry per spoken line"} lines, in the same order, with the same speaker and the same Indonesian text, character for character. Do not merge, split, add, drop or reword lines.`
    : `MODE: IMPORT + ADAPT. Use the pasted lines as the base and refine them following the direction notes (pacing, length, wording). Keep the characters' voices, the facts and the jokes; keep it casual Jakarta Indonesian.`
}

For every line fill in:
- beat. ${BEAT_GUIDE}
- expression: one of ${EXPRESSIONS.join(", ")}, from the delivery cues (e.g. loud/outraged → angry or furious, flat → deadpan, shocked → shocked, smug → smug).
- thought_bubble: true for inner thoughts (marked "(inner thought)", "(thought)", "dalam hati" or similar), else false. Inner thoughts use expression "thinking" unless the cues say otherwise.
- subtitle: the [EN] translation when given (copy it); otherwise translate naturally into English.
- visual: one concise line combining the acting cues and the matching row of any visual/SFX table.
- on_screen_text: only when the paste or notes give on-screen text for that line, else null.
- delivery: the delivery cue in a few words (pace, emotion, emphasis), or null.
- title: a short episode title${p.currentTitle ? ` (keep "${p.currentTitle}" unless the paste names another)` : ""}.
Never put the creator's instructions or the raw paste into any field.`,
  });

  let out = result.lines;
  if (exact && lines.length) {
    // The parsed Indonesian text, speaker and thought flag win; the model only contributes the mapping.
    if (out.length !== lines.length) {
      throw new Error(`The formatter returned ${out.length} lines for ${lines.length} pasted lines. Try again, or use Import + Adapt.`);
    }
    out = lines.map((l, i) => ({
      ...out[i],
      speaker: l.speaker,
      text: l.text,
      subtitle: l.en ?? out[i].subtitle,
      thought_bubble: l.thought || out[i].thought_bubble,
    }));
  }
  if (!out.length) throw new Error("No dialogue lines found. Put each line on its own row starting with UCO: or OCU:.");
  const seconds = estimateSeconds(out);
  const note = `Imported ${out.length}-line script (~${formatDuration(seconds)})${exact ? "" : ", adapted to your notes"}`;
  return {
    script: { title: result.title || p.currentTitle || "Imported script", target_duration_s: seconds, lines: out, sources: [] },
    parsed: lines.length,
    note,
  };
}

/** Parses, maps and saves a pasted script as the episode's next version. Older versions stay as they are. */
export async function importScript(p: { ownerId: string; projectId: string; mode: ImportMode; paste: string; notes: string }) {
  const paste = p.paste.trim();
  if (paste.length < 10) throw new Error("Paste the script first.");
  if (paste.length > 30000) throw new Error("That script is over 30,000 characters. Paste one episode at a time.");
  const sql = db();
  const [project] = await sql<{ id: string; title: string | null; selected_concept_id: string | null }[]>`
    SELECT id, title, selected_concept_id FROM content_projects WHERE id = ${p.projectId} AND user_id = ${p.ownerId}`;
  if (!project) throw new Error("Episode not found.");
  const [prev] = await sql<{ concept_id: string | null; fact_sheet: string | null; sources: Script["sources"] }[]>`
    SELECT concept_id, fact_sheet, sources FROM scripts WHERE project_id = ${p.projectId} ORDER BY version DESC LIMIT 1`;

  const { script, note } = await mapImportedScript({
    projectId: p.projectId,
    mode: p.mode,
    paste,
    notes: p.notes.trim().slice(0, 8000),
    currentTitle: project.title,
  });
  const [{ v }] = await sql<{ v: number }[]>`SELECT COALESCE(max(version), 0) + 1 AS v FROM scripts WHERE project_id = ${p.projectId}`;
  await sql`
    INSERT INTO scripts (project_id, concept_id, version, title, target_duration_s, lines, fact_sheet, sources, feedback)
    VALUES (${p.projectId}, ${prev?.concept_id ?? project.selected_concept_id}, ${v}, ${script.title}, ${script.target_duration_s},
            ${sql.json(script.lines as never)}, ${prev?.fact_sheet ?? null}, ${sql.json((prev?.sources ?? []) as never)}, ${note})`;
  await sql`
    UPDATE content_projects SET title = ${script.title}, status = 'awaiting_script_approval', last_error = NULL, updated_at = now()
    WHERE id = ${p.projectId}`;
  return { version: v, lines: script.lines.length, seconds: script.target_duration_s, note };
}

/** One line edited in place (no new version): Indonesian text, English subtitle, expression, visual, on-screen text. */
export async function updateScriptLine(p: {
  ownerId: string;
  projectId: string;
  scriptId: string;
  index: number;
  patch: { text: string; subtitle: string; expression: string; visual: string; on_screen_text: string | null; thought_bubble: boolean };
}) {
  if (!(EXPRESSIONS as readonly string[]).includes(p.patch.expression)) throw new Error("Unknown expression.");
  if (!p.patch.text.trim()) throw new Error("The Indonesian line can't be empty.");
  const sql = db();
  const [row] = await sql<{ lines: Script["lines"] }[]>`
    SELECT s.lines FROM scripts s JOIN content_projects c ON c.id = s.project_id
    WHERE s.id = ${p.scriptId} AND s.project_id = ${p.projectId} AND c.user_id = ${p.ownerId}`;
  if (!row || !row.lines[p.index]) throw new Error("That line doesn't exist anymore. Reload the page.");
  const lines = row.lines.map((l, i) =>
    i === p.index
      ? {
          ...l,
          text: p.patch.text.trim(),
          subtitle: p.patch.subtitle.trim(),
          expression: p.patch.expression as Script["lines"][number]["expression"],
          visual: p.patch.visual.trim(),
          on_screen_text: p.patch.on_screen_text?.trim() || null,
          thought_bubble: p.patch.thought_bubble,
        }
      : l,
  );
  await sql`UPDATE scripts SET lines = ${sql.json(lines as never)}, target_duration_s = ${estimateSeconds(lines)} WHERE id = ${p.scriptId}`;
}
