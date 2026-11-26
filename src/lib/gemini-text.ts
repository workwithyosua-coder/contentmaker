import "server-only";
import { GEMINI_KEY_MISSING } from "./voice/gemini";

// Gemini text generation (free tier) for the autonomous scheduler: topic seeds and unattended scripts as JSON.
// Key: GEMINI_API_KEY (the same key as Gemini TTS). Never the Anthropic API.

const API = () => process.env.GEMINI_API_BASE?.trim() || "https://generativelanguage.googleapis.com/v1beta"; // override only for tests
export const GEMINI_TEXT_MODEL = () => process.env.GEMINI_TEXT_MODEL?.trim() || "gemini-2.5-flash";

/** Asks Gemini for JSON matching `schema` (OpenAPI subset). Throws a clear error on a missing key, quota or bad JSON. */
export async function geminiJson<T>(prompt: string, schema: Record<string, unknown>, opts: { temperature?: number } = {}): Promise<T> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error(GEMINI_KEY_MISSING);
  const res = await fetch(`${API()}/models/${GEMINI_TEXT_MODEL()}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: opts.temperature ?? 0.9 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = (await res.json()) as { error?: { message?: string; status?: string } };
      msg = j.error?.message ?? j.error?.status ?? msg;
    } catch {}
    if (res.status === 401 || res.status === 403) msg = `the API key was rejected (${msg}). Check GEMINI_API_KEY.`;
    if (res.status === 429) msg = `the free Gemini quota is used up for now (${msg}). The slot can be retried later.`;
    throw new Error(`Gemini: ${msg}`);
  }
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] };
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Gemini returned something that isn't JSON (${j.candidates?.[0]?.finishReason ?? "no reason"}). Retry the slot.`);
  }
}
