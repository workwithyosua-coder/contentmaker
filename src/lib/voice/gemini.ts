import "server-only";
import { GEMINI_VOICES, pcmRate, pcmToWav } from "./acting";

// Gemini native text-to-speech (free tier): built-in voices, the acting direction as a spoken-style instruction and
// the script line verbatim (see acting.ts). Returns a WAV file. Key: GEMINI_API_KEY in the environment (never in code).

const API = process.env.GEMINI_API_BASE?.trim() || "https://generativelanguage.googleapis.com/v1beta"; // override only for tests
export const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL?.trim() || "gemini-2.5-flash-preview-tts";
export const GEMINI_KEY_MISSING = "GEMINI_API_KEY is not set in environment variables.";

export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY?.trim());

/** Speaks `prompt` in the character's Gemini voice. Throws a clear error (missing key, quota, API) instead of crashing. */
export async function speakGemini(prompt: string, speaker: "uco" | "ocu"): Promise<Uint8Array> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error(GEMINI_KEY_MISSING);
  const res = await fetch(`${API}/models/${GEMINI_TTS_MODEL}:generateContent`, {
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
    let msg = `${res.status}`;
    try {
      const j = (await res.json()) as { error?: { message?: string; status?: string } };
      msg = j.error?.message ?? j.error?.status ?? msg;
    } catch {}
    if (res.status === 401 || res.status === 403) msg = `the API key was rejected (${msg}). Check GEMINI_API_KEY.`;
    if (res.status === 429) msg = `the free Gemini TTS quota is used up for now (${msg}). Try again later.`;
    throw new Error(`Gemini TTS: ${msg}`);
  }
  const j = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] };
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!part?.data) throw new Error("Gemini TTS: no audio came back. Try the line again.");
  return pcmToWav(new Uint8Array(Buffer.from(part.data, "base64")), pcmRate(part.mimeType));
}
