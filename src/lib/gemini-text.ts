import "server-only";
import { GEMINI_KEY_MISSING, GeminiError, geminiApiKey, geminiErrorDetail, geminiTextModels, isModelError, parseGeminiJson } from "./gemini-core";

// Gemini text generation (free tier) for the autonomous scheduler: topic seeds and unattended scripts.
// Key: the same lookup as Gemini TTS (gemini-core.ts). Model: GEMINI_TEXT_MODEL, else gemini-3.5-flash-lite, with
// gemini-3.8-flash tried when the first model is retired or unknown. Never the Anthropic API.

const API = () => process.env.GEMINI_API_BASE?.trim() || "https://generativelanguage.googleapis.com/v1beta"; // override only for tests

/**
 * Gemini's raw text answer (JSON mode when `schema` is given). Throws GeminiError with the HTTP status, model and
 * Gemini's own message; every failure is also logged, so it shows in the Vercel log.
 */
export async function geminiText(prompt: string, opts: { schema?: Record<string, unknown>; temperature?: number } = {}): Promise<{ text: string; model: string }> {
  const key = geminiApiKey();
  if (!key) throw new Error(GEMINI_KEY_MISSING);
  const models = geminiTextModels();
  let last: GeminiError | null = null;
  for (const model of models) {
    let res: Response;
    try {
      res = await fetch(`${API()}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key.key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: opts.temperature ?? 0.9,
            ...(opts.schema ? { responseMimeType: "application/json", responseSchema: opts.schema } : {}),
          },
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      last = new GeminiError(0, model, e instanceof Error ? e.message : String(e));
      console.error(`[gemini] ${last.message}`);
      throw last;
    }
    if (!res.ok) {
      const detail = geminiErrorDetail(res.status, await res.text().catch(() => ""));
      last = new GeminiError(res.status, model, detail);
      console.error(`[gemini] ${last.message}`);
      if (isModelError(res.status, detail) && model !== models.at(-1)) continue; // retired / unknown model: try the fallback
      throw last;
    }
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) {
      const why = j.promptFeedback?.blockReason ?? j.candidates?.[0]?.finishReason ?? "no candidates";
      last = new GeminiError(res.status, model, `empty answer (${why})`);
      console.error(`[gemini] ${last.message}`);
      throw last;
    }
    return { text, model };
  }
  throw last ?? new GeminiError(0, models[0], "no model to call");
}

/** JSON matching `schema`, parsed tolerantly (code fences and stray prose removed). */
export async function geminiJson<T>(prompt: string, schema: Record<string, unknown>, opts: { temperature?: number } = {}): Promise<T> {
  const { text, model } = await geminiText(prompt, { schema, temperature: opts.temperature });
  try {
    return parseGeminiJson<T>(text);
  } catch {
    const err = new GeminiError(200, model, `answer isn't JSON: ${text.replace(/\s+/g, " ").slice(0, 160)}`);
    console.error(`[gemini] ${err.message}`);
    throw err;
  }
}
