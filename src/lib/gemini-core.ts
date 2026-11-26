// Shared by Gemini TTS (voice/gemini.ts) and Gemini text (gemini-text.ts): the API key lookup, the text model ids with
// their fallback, error details that say what Gemini actually answered, and tolerant JSON / topic parsing.
// Pure code (no server-only, no network), so the unit tests cover it directly.

/** Where the Gemini key is read from, in order. TTS and the scheduler use this same chain. */
export const GEMINI_KEY_VARS = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY"] as const;
export const GEMINI_KEY_MISSING = "GEMINI_API_KEY is not set in environment variables.";

export function geminiApiKey(env: Record<string, string | undefined> = process.env): { key: string; from: (typeof GEMINI_KEY_VARS)[number] } | null {
  for (const name of GEMINI_KEY_VARS) {
    const v = env[name]?.trim();
    if (v) return { key: v, from: name };
  }
  return null;
}

/** Text models for topics and scripts: GEMINI_TEXT_MODEL, else the default; the fallback is tried on a model error. */
export const GEMINI_TEXT_DEFAULT = "gemini-3.5-flash-lite";
export const GEMINI_TEXT_FALLBACK = "gemini-3.8-flash";
export function geminiTextModels(env: Record<string, string | undefined> = process.env): string[] {
  const first = env.GEMINI_TEXT_MODEL?.trim() || GEMINI_TEXT_DEFAULT;
  return first === GEMINI_TEXT_FALLBACK ? [first] : [first, GEMINI_TEXT_FALLBACK];
}

/** A failed Gemini call, with the HTTP status, the model and Gemini's own (short) message. */
export class GeminiError extends Error {
  constructor(
    readonly status: number,
    readonly model: string,
    readonly detail: string,
  ) {
    super(`Gemini ${status || "network error"} (${model}): ${detail}`);
    this.name = "GeminiError";
  }
}

/** Gemini's error message from a response body (JSON `{ error: { message, status } }` or plain text), shortened. */
export function geminiErrorDetail(status: number, body: string): string {
  let msg = body.trim();
  try {
    const j = JSON.parse(body) as { error?: { message?: string; status?: string } };
    msg = [j.error?.status, j.error?.message].filter(Boolean).join(": ") || msg;
  } catch {}
  msg = msg.replace(/\s+/g, " ").slice(0, 240) || "no error message";
  if (status === 401 || status === 403) return `${msg}. The API key was rejected: check ${GEMINI_KEY_VARS[0]}.`;
  if (status === 429) return `${msg}. The free quota is used up for now: retry the slot later.`;
  return msg;
}

/** A retired / unknown / unsupported model (worth trying the fallback model), not a key, quota or prompt problem. */
export function isModelError(status: number, detail: string): boolean {
  if (status === 404) return true;
  return status === 400 && /\bmodels?\b.*\b(not found|not supported|is not|unsupported|deprecated|retired|no longer)\b|NOT_FOUND/i.test(detail);
}

/** Removes a ```json … ``` (or plain ```) fence and surrounding whitespace. */
export function stripFences(text: string): string {
  const t = text.trim();
  const m = /^```[\w-]*\s*\n?([\s\S]*?)\n?\s*```$/.exec(t);
  return (m ? m[1] : t).trim();
}

/** JSON from Gemini's text: fences stripped; when there's prose around it, the first {…} or […] block. */
export function parseGeminiJson<T>(text: string): T {
  const t = stripFences(text);
  try {
    return JSON.parse(t) as T;
  } catch {
    const start = t.search(/[[{]/);
    const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1)) as T;
    throw new Error("not JSON");
  }
}

const cleanTopic = (s: string) =>
  s
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/^["“”']+|["“”']+$/g, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

/**
 * Topic seeds from whatever Gemini returned: `{ "seeds": [...] }`, a bare array, a JSON string, any of those in a
 * code fence, or plain text (one topic per line, bullets / numbers removed). At most `max`.
 */
export function parseSeeds(text: string, max: number): string[] {
  let items: unknown[] | null = null;
  try {
    const j = parseGeminiJson<unknown>(text);
    if (Array.isArray(j)) items = j;
    else if (typeof j === "string") items = [j];
    else if (j && typeof j === "object") {
      const o = j as Record<string, unknown>;
      const list = o.seeds ?? o.topics ?? o.topic ?? Object.values(o).find(Array.isArray);
      items = Array.isArray(list) ? list : typeof list === "string" ? [list] : null;
    }
  } catch {}
  if (!items) items = stripFences(text).split(/\r?\n/);
  return items
    .map((x) => cleanTopic(typeof x === "string" ? x : x && typeof x === "object" ? String((x as Record<string, unknown>).topic ?? (x as Record<string, unknown>).seed ?? "") : ""))
    .filter((s) => s.length >= 3 && !/^[[\]{}]+$/.test(s))
    .slice(0, max);
}
