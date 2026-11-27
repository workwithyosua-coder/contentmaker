// Free Microsoft Edge TTS (edge-tts, voice id-ID-ArdiNeural), run inside the GitHub Actions worker: the base voice of
// scheduled Own Voice episodes, and the fallback when Gemini TTS is out of quota. This module is the app's half: which lines need a voice, the text
// the voice reads, and each line's prosody (rate / pitch from the character and the pose). Pure code: no network, no AI.
//
// Routing in the scheduler (Gemini API key on Paid Tier 1):
//   gemini_tts_rvc (Own Voice): gemini-3.8-flash-tts first (the acted base takes, tail-cleaned), then RVC converts them
//   both Gemini providers:       requests paced at ≤ 9 a minute and a 429 retried 3 times (tts-pacing.ts), so an
//                               episode stays on one voice; Edge TTS only as the emergency fallback after that
//   gemini_tts:                  gemini-3.8-flash-tts first; on 429 / quota, Edge TTS takes over the remaining lines
import { RVC_BASE_MARK } from "../renderWorker";
import { actingPose, assertSpokenOnly, linesToVoice, type VoiceProvider } from "./acting";
import { ttsText, type PronunciationOverride } from "./phonetic";

export const EDGE_VOICE = "id-ID-ArdiNeural";
/** In every Edge TTS take's ai_prompt (also kept on RVC conversions of one), so the renderer can tell them apart. */
export const EDGE_TAG = "edge-tts";
export const EDGE_FALLBACK_MARK = "[edge_tts]";

export type Prosody = { rate: string; pitch: string };
type ProsodyLine = { speaker: "uco" | "ocu"; emotion?: string | null; expression?: string | null; thought_bubble?: boolean | null };

/**
 * The character's pace and pitch for a line, from its pose, at natural speaking speed (energy from pitch and the
 * voice, not from rushing):
 *   Uco (a touch quicker, higher): base +2% / +4Hz · angry, shocked, defensive +4% / +8Hz · thought −4% / −2Hz
 *   Ocu (steady, deeper):          base +0% / −4Hz · deadpan, thought −2% / −6Hz · explaining, inspecting, cta +3% / −2Hz
 */
export function edgeProsody(l: ProsodyLine): Prosody & { pose: string } {
  const pose = actingPose(l);
  if (l.speaker === "uco") {
    if (pose === "angry" || pose === "shocked" || pose === "defensive") return { pose, rate: "+4%", pitch: "+8Hz" };
    if (pose === "thought") return { pose, rate: "-4%", pitch: "-2Hz" };
    return { pose, rate: "+2%", pitch: "+4Hz" };
  }
  if (pose === "deadpan" || pose === "thought") return { pose, rate: "-2%", pitch: "-6Hz" };
  if (pose === "explaining" || pose === "inspecting" || pose === "cta") return { pose, rate: "+3%", pitch: "-2Hz" };
  return { pose, rate: "+0%", pitch: "-4Hz" };
}

/**
 * The take's ai_prompt: an Own Voice base take carries the RVC base mark (so Stage B converts it, exactly like a
 * Gemini base take); a Gemini-fallback take is marked [edge_tts] (never converted).
 */
export function edgeMark(provider: VoiceProvider, p: Prosody & { pose?: string }): string {
  const what = `${EDGE_TAG} ${EDGE_VOICE} rate=${p.rate} pitch=${p.pitch}${p.pose ? ` pose=${p.pose}` : ""}`;
  return provider === "gemini_tts_rvc" ? `${RVC_BASE_MARK} ${what}` : `${EDGE_FALLBACK_MARK} ${what}`;
}

export const isEdgeTake = (aiPrompt: string | null | undefined) => Boolean(aiPrompt?.includes(EDGE_TAG));

/**
 * The take's source as the renderer sees it: "ai_edge" for Edge TTS takes (and their RVC conversions) and "ai_gemini"
 * for Gemini TTS takes (and theirs), which speak at a natural pace already, so the renderer doesn't speed them up
 * like ElevenLabs takes ("ai").
 */
export function takeSource(source: string, aiPrompt: string | null | undefined): string {
  if (source !== "ai") return source;
  if (isEdgeTake(aiPrompt)) return "ai_edge";
  // Gemini TTS takes (and their RVC conversions) already speak at a natural pace: never sped up again
  if (/^\[(gemini_tts|rvc)\b|^\[gemini_tts_rvc:base\]/.test(aiPrompt ?? "")) return "ai_gemini";
  return "ai";
}

/**
 * Which engine a scheduled episode is voiced with: gemini-3.8-flash-tts for both Gemini providers (Own Voice: the
 * acted, tail-cleaned base takes go on to RVC). Edge TTS only as the emergency fallback once a 429 survived its
 * paced retries (isQuotaError). Anything else: Edge TTS (never ElevenLabs unattended).
 */
export function schedulerVoiceEngine(provider: VoiceProvider): "edge" | "gemini" {
  return provider === "gemini_tts" || provider === "gemini_tts_rvc" ? "gemini" : "edge";
}

/** A TTS failure that means "out of quota / rate limited": the cue to hand the rest of the slot to Edge TTS. */
export function isQuotaError(message: string): boolean {
  return /\b429\b|quota|RESOURCE_EXHAUSTED|rate.?limit|too many requests/i.test(message);
}

export type EdgeJob = { lineIndex: number; speaker: "uco" | "ocu"; text: string; rate: string; pitch: string; pose: string; leadIn: boolean };

/**
 * The worker's Edge TTS jobs: every line WITHOUT a take (cached audio is never voiced again), with the phonetic text
 * the voice reads ("&" → "dan", "@uco.ocu" → "Uco Ocu"; the stored script and subtitles stay as written) and its prosody.
 */
export function edgeJobs(lines: (ProsodyLine & { index: number; text: string })[], hasTake: (index: number) => boolean, overrides: readonly PronunciationOverride[] = []): EdgeJob[] {
  return linesToVoice(lines, hasTake, "missing")
    .filter((l) => (l.speaker === "uco" || l.speaker === "ocu") && l.text.trim())
    .map((l) => {
      const p = edgeProsody(l);
      return { lineIndex: l.index, speaker: l.speaker, text: assertSpokenOnly(ttsText(l.text, "edge", overrides)), rate: p.rate, pitch: p.pitch, pose: p.pose, leadIn: l.index === 0 };
    });
}
