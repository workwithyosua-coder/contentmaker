import "server-only";
import { cleanPcmTailStats, geminiPcm, pcmToWav, ttsRequestBody, type PcmPayload } from "./acting";
import type { TailReport } from "../../../video/src/voicedTail";
import { TTS_MAX_429_RETRIES, TtsPacer, pacedRequest, realClock } from "./tts-pacing";
import { GEMINI_KEY_MISSING, geminiApiKey, geminiErrorDetail, geminiTtsModels, isModelError } from "../gemini-core";

// Gemini native text-to-speech: built-in voices, the acting direction as a spoken-style instruction and
// the script line verbatim (see acting.ts). Returns a WAV file. Key: GEMINI_API_KEY in the environment (never in code).

const API = () => process.env.GEMINI_API_BASE?.trim() || "https://generativelanguage.googleapis.com/v1beta"; // override only for tests
export { GEMINI_KEY_MISSING };

/** The key lookup shared with the scheduler's Gemini text calls (GEMINI_API_KEY, then GOOGLE_API_KEY, GOOGLE_AI_API_KEY). */
export const geminiConfigured = () => Boolean(geminiApiKey());

/**
 * Speaks `text` (the line only, exactly as it should be heard) in the character's Gemini voice (Puck for Uco, Charon
 * for Ocu), delivered as `style` (speechMetadata.style, never spoken), on /v1beta with gemini-3.8-flash-tts, falling
 * back to gemini-3.8-flash-lite-tts when that model is unknown or retired (GEMINI_TTS_MODEL overrides the first).
 * Throws a clear error (missing key, quota, API) instead of crashing; a quota error says "quota" (the scheduler's
 * worker hands the rest of the slot to Edge TTS on it).
 */
export async function speakGemini(text: string, style: string, speaker: "uco" | "ocu"): Promise<Uint8Array> {
  return (await speakGeminiTake(text, style, speaker)).wav;
}

/** One instance-wide pacer: TTS request starts at least 60 / 9 s apart (Tier 1 allows 10 a minute). */
const pacer = new TtsPacer();

/** speakGemini, with how much of the take's tail was cut (for the worker log). */
export async function speakGeminiTake(text: string, style: string, speaker: "uco" | "ocu"): Promise<{ wav: Uint8Array; originalMs: number; keptMs: number; model: string; payload: Omit<PcmPayload, "pcm">; tail: TailReport }> {
  const key = geminiApiKey()?.key;
  if (!key) throw new Error(GEMINI_KEY_MISSING);
  const body = JSON.stringify(ttsRequestBody(text, style, speaker));
  const models = geminiTtsModels();
  for (const model of models) {
    // paced (≤ 9 a minute) and a 429 retried up to 3 times (Retry-After / Google's retryDelay / backoff) before it
    // counts as a quota error (the scheduler's last resort is Edge TTS)
    const res = await pacedRequest(
      () =>
        fetch(`${API()}/models/${model}:generateContent`, {
          method: "POST",
          headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(90_000),
        }),
      pacer,
      realClock,
      (attempt, wait) => console.warn(`[gemini-tts] 429 (${model}), retry ${attempt} of ${TTS_MAX_429_RETRIES} in ${Math.round(wait / 1000)} s`),
    );
    if (!res.ok) {
      const detail = geminiErrorDetail(res.status, await res.text().catch(() => ""));
      console.error(`[gemini-tts] ${res.status} (${model}): ${detail}`);
      if (isModelError(res.status, detail) && model !== models.at(-1)) continue;
      if (res.status === 429) throw new Error(`Gemini TTS: the Gemini TTS quota is used up for now (429 after ${TTS_MAX_429_RETRIES} retries, ${model}: ${detail})`);
      throw new Error(`Gemini TTS ${res.status} (${model}): ${detail}`);
    }
    const j = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] };
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!part?.data) throw new Error(`Gemini TTS (${model}): no audio came back. Try the line again.`);
    // the take ends at its last word: Gemini's trailing click is cut here (frame-level speech-end detection), before
    // it's stored or converted by RVC
    // the payload checked (raw L16 PCM; a WAV container or a trailer chunk would be stripped, MP3 / OGG refused),
    // then the tail classified by its spectrum and cut after the last voiced frame
    const { pcm, ...payload } = geminiPcm(new Uint8Array(Buffer.from(part.data, "base64")), part.mimeType);
    const clean = cleanPcmTailStats(pcm, payload.rate);
    return { wav: pcmToWav(clean.pcm, payload.rate), originalMs: clean.originalMs, keptMs: clean.keptMs, model, payload, tail: clean.tail };
  }
  throw new Error("Gemini TTS: no model to call.");
}
