// Free Microsoft Edge TTS (edge-tts, voice id-ID-ArdiNeural), run inside the GitHub Actions worker as the fallback
// when Gemini TTS is out of quota. This module is the app's half: which lines need a voice, the text
// the voice reads, and each line's prosody (rate / pitch from the character and the pose). Pure code: no network, no AI.
//
// Routing in the scheduler (Gemini API key on Paid Tier 1):
//   gemini_tts_rvc (Own Voice): gemini-3.8-flash-tts first (the acted base takes), then RVC converts them; on a 429 /
//                               quota error Edge TTS makes the remaining base takes in the worker (also converted)
//   gemini_tts:                  gemini-3.8-flash-tts first; on 429 / quota, Edge TTS takes over the remaining lines
import { RVC_BASE_MARK } from "../renderWorker";
import { actingPose, assertSpokenOnly, linesToVoice, type VoiceProvider } from "./acting";
import { ttsText } from "./phonetic";

export const EDGE_VOICE = "id-ID-ArdiNeural";
/** In every Edge TTS take's ai_prompt (also kept on RVC conversions of one), so the renderer can tell them apart. */
export const EDGE_TAG = "edge-tts";
export const EDGE_FALLBACK_MARK = "[edge_tts]";

export type Prosody = { rate: string; pitch: string };
type ProsodyLine = { speaker: "uco" | "ocu"; emotion?: string | null; expression?: string | null; thought_bubble?: boolean | null };

/**
 * The character's pace and pitch for a line, from its pose:
 *   Uco (faster, higher):   base +10% / +4Hz · angry, shocked, defensive +16% / +8Hz · thought −4% / −2Hz
 *   Ocu (steadier, deeper): base +5% / −4Hz  · deadpan, thought −2% / −6Hz · explaining, inspecting, cta +8% / −2Hz
 */
export function edgeProsody(l: ProsodyLine): Prosody & { pose: string } {
  const pose = actingPose(l);
  if (l.speaker === "uco") {
    if (pose === "angry" || pose === "shocked" || pose === "defensive") return { pose, rate: "+16%", pitch: "+8Hz" };
    if (pose === "thought") return { pose, rate: "-4%", pitch: "-2Hz" };
    return { pose, rate: "+10%", pitch: "+4Hz" };
  }
  if (pose === "deadpan" || pose === "thought") return { pose, rate: "-2%", pitch: "-6Hz" };
  if (pose === "explaining" || pose === "inspecting" || pose === "cta") return { pose, rate: "+8%", pitch: "-2Hz" };
  return { pose, rate: "+5%", pitch: "-4Hz" };
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
 * The take's source as the renderer sees it: "ai_edge" for Edge TTS takes (and their RVC conversions), which already
 * have their pace from the prosody, so the renderer doesn't speed them up again like other AI takes.
 */
export function takeSource(source: string, aiPrompt: string | null | undefined): string {
  return source === "ai" && isEdgeTake(aiPrompt) ? "ai_edge" : source;
}

/**
 * Which engine the scheduler's worker voices with first: Gemini TTS for both Gemini providers (Own Voice keeps the
 * full acted Indonesian delivery before RVC). Edge TTS only takes over after a 429 / quota error (isQuotaError).
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
 * the voice reads ("&" → "dan", "Uco" → "U-co"; the stored script and subtitles stay as written) and its prosody.
 */
export function edgeJobs(lines: (ProsodyLine & { index: number; text: string })[], hasTake: (index: number) => boolean): EdgeJob[] {
  return linesToVoice(lines, hasTake, "missing")
    .filter((l) => (l.speaker === "uco" || l.speaker === "ocu") && l.text.trim())
    .map((l) => {
      const p = edgeProsody(l);
      return { lineIndex: l.index, speaker: l.speaker, text: assertSpokenOnly(ttsText(l.text)), rate: p.rate, pitch: p.pitch, pose: p.pose, leadIn: l.index === 0 };
    });
}
