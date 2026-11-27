import "server-only";
import { storeTake, type SaveResult } from "../takes";
import { geminiSpeech, routeVoice, wavDurationMs, type DeliveryPreset, type VoiceProvider } from "./acting";
import { DEFAULT_SETTINGS, directLine } from "./direction";
import { elevenLabsConfigured, speak } from "./elevenlabs";
import { geminiConfigured, speakGeminiTake } from "./gemini";
import { getVoiceProfiles } from "./profiles";
import { rvcModelStatus } from "../studio-assets";
import { RVC_BASE_MARK } from "../renderWorker";
import { tailSummary } from "../../../video/src/voicedTail";

// One door for every AI voice: the episode's provider decides the engine (Gemini TTS, free, by default; ElevenLabs
// with the cloned voices; Own-Voice RVC later), and every take is stored the same way, as that line's selected take
// in Storage, so a re-render never asks a provider again.

type Line = { speaker: "uco" | "ocu"; text: string; expression: string; emotion?: string | null; thought_bubble?: boolean; delivery?: string | null; beat?: string; layout?: string | null };

export async function voiceTake(p: {
  userId: string;
  projectId: string;
  scriptId: string;
  lineIndex: number;
  line: Line;
  provider: VoiceProvider;
  preset: DeliveryPreset;
  extra?: string;
}): Promise<SaveResult & { trim?: { originalMs: number; keptMs: number; summary: string; payload: string } }> {
  const profiles = p.provider === "elevenlabs" && elevenLabsConfigured() ? await getVoiceProfiles(p.userId).catch(() => ({})) : {};
  const rvcModels = p.provider === "gemini_tts_rvc" ? await rvcModelStatus().catch(() => ({ uco: false, ocu: false })) : undefined;
  const route = routeVoice(
    p.provider,
    { geminiKey: geminiConfigured(), elevenLabsKey: elevenLabsConfigured(), elevenLabsVoices: "uco" in profiles && "ocu" in profiles, rvcModels },
    [p.line.speaker],
  );
  if (!route.ok) return { ok: false, message: route.message };

  if (route.engine === "gemini") {
    // Own Voice: this is Stage A, the acted base take; the render worker converts it to the user's voice (Stage B)
    // the dialogue only (verbatim) as text, the acting cue as speechMetadata.style
    const { text, style } = geminiSpeech(p.line, p.preset, p.extra);
    const { wav, originalMs, keptMs, payload, tail } = await speakGeminiTake(text, style, p.line.speaker);
    const mark = route.rvc ? RVC_BASE_MARK : "[gemini_tts]";
    const prompt = `style: ${style} | text: ${text}`;
    const stored = await storeTake({ ownerId: p.userId, projectId: p.projectId, scriptId: p.scriptId, lineIndex: p.lineIndex, data: wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer, mime: "audio/wav", ext: "wav", durationMs: wavDurationMs(wav), source: "ai", aiPrompt: `${mark} ${prompt}` });
    return {
      ...stored,
      trim: {
        originalMs,
        keptMs,
        summary: tailSummary(tail),
        payload: `${payload.mime || "no mime type"}, ${payload.bytes} bytes, ${payload.rate} Hz, ${payload.container}${payload.strippedBytes ? `, ${payload.strippedBytes} non-PCM byte(s) stripped` : ", nothing stripped"}`,
      },
    };
  }

  const profile = (profiles as Record<string, { voice_id: string; settings?: Record<string, unknown> | null }>)[p.line.speaker];
  const prompt = directLine(p.line, p.extra);
  const { model, ...settings } = (profile.settings ?? {}) as { model?: string };
  const audio = await speak(profile.voice_id, prompt, { model, settings: { ...DEFAULT_SETTINGS[p.line.speaker], ...settings } });
  return storeTake({ ownerId: p.userId, projectId: p.projectId, scriptId: p.scriptId, lineIndex: p.lineIndex, data: audio, mime: "audio/mpeg", ext: "mp3", durationMs: null, source: "ai", aiPrompt: prompt });
}
