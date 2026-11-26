import "server-only";
import { GEMINI_VOICES, pcmRate, pcmToWav } from "./acting";
import { GEMINI_KEY_MISSING, geminiApiKey, geminiErrorDetail, geminiTtsModels, isModelError } from "../gemini-core";

// Gemini native text-to-speech: built-in voices, the acting direction as a spoken-style instruction and
// the script line verbatim (see acting.ts). Returns a WAV file. Key: GEMINI_API_KEY in the environment (never in code).

const API = () => process.env.GEMINI_API_BASE?.trim() || "https://generativelanguage.googleapis.com/v1beta"; // override only for tests
export { GEMINI_KEY_MISSING };

/** The key lookup shared with the scheduler's Gemini text calls (GEMINI_API_KEY, then GOOGLE_API_KEY, GOOGLE_AI_API_KEY). */
export const geminiConfigured = () => Boolean(geminiApiKey());

/**
 * Speaks `prompt` in the character's Gemini voice (Puck for Uco, Charon for Ocu) with gemini-3.8-flash-tts, falling
 * back to gemini-3.8-flash-lite-tts when that model is unknown or retired (GEMINI_TTS_MODEL overrides the first).
 * Throws a clear error (missing key, quota, API) instead of crashing; a quota error says "quota" (the scheduler's
 * worker hands the rest of the slot to Edge TTS on it).
 */
export async function speakGemini(prompt: string, speaker: "uco" | "ocu"): Promise<Uint8Array> {
  const key = geminiApiKey()?.key;
  if (!key) throw new Error(GEMINI_KEY_MISSING);
  const models = geminiTtsModels();
  for (const model of models) {
    const res = await fetch(`${API()}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICES[speaker] } } },
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const detail = geminiErrorDetail(res.status, await res.text().catch(() => ""));
      console.error(`[gemini-tts] ${res.status} (${model}): ${detail}`);
      if (isModelError(res.status, detail) && model !== models.at(-1)) continue;
      if (res.status === 429) throw new Error(`Gemini TTS: the Gemini TTS quota is used up for now (429, ${model}: ${detail})`);
      throw new Error(`Gemini TTS ${res.status} (${model}): ${detail}`);
    }
    const j = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] };
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!part?.data) throw new Error(`Gemini TTS (${model}): no audio came back. Try the line again.`);
    return pcmToWav(new Uint8Array(Buffer.from(part.data, "base64")), pcmRate(part.mimeType));
  }
  throw new Error("Gemini TTS: no model to call.");
}
