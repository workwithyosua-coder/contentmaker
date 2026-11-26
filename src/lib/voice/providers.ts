import "server-only";
import { storeTake, type SaveResult } from "../takes";
import { geminiPrompt, routeVoice, wavDurationMs, type DeliveryPreset, type VoiceProvider } from "./acting";
import { DEFAULT_SETTINGS, directLine } from "./direction";
import { elevenLabsConfigured, speak } from "./elevenlabs";
import { geminiConfigured, speakGemini } from "./gemini";
import { getVoiceProfiles } from "./profiles";

// One door for every AI voice: the episode's provider decides the engine (Gemini TTS, free, by default; ElevenLabs
// with the cloned voices; Own-Voice RVC later), and every take is stored the same way, as that line's selected take
// in Storage, so a re-render never asks a provider again.

type Line = { speaker: "uco" | "ocu"; text: string; expression: string; emotion?: string | null; thought_bubble?: boolean; delivery?: string | null; beat?: string };

export async function voiceTake(p: {
  userId: string;
  projectId: string;
  scriptId: string;
  lineIndex: number;
  line: Line;
  provider: VoiceProvider;
  preset: DeliveryPreset;
  extra?: string;
}): Promise<SaveResult> {
  const profiles = p.provider === "elevenlabs" && elevenLabsConfigured() ? await getVoiceProfiles(p.userId).catch(() => ({})) : {};
  const route = routeVoice(p.provider, {
    geminiKey: geminiConfigured(),
    elevenLabsKey: elevenLabsConfigured(),
    elevenLabsVoices: "uco" in profiles && "ocu" in profiles,
  });
  if (!route.ok) return { ok: false, message: route.message };

  if (route.engine === "gemini") {
    const prompt = geminiPrompt(p.line, p.preset, p.extra);
    const wav = await speakGemini(prompt, p.line.speaker);
    return storeTake({ ownerId: p.userId, projectId: p.projectId, scriptId: p.scriptId, lineIndex: p.lineIndex, data: wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer, mime: "audio/wav", ext: "wav", durationMs: wavDurationMs(wav), source: "ai", aiPrompt: `[gemini_tts] ${prompt}` });
  }

  const profile = (profiles as Record<string, { voice_id: string; settings?: Record<string, unknown> | null }>)[p.line.speaker];
  const prompt = directLine(p.line, p.extra);
  const { model, ...settings } = (profile.settings ?? {}) as { model?: string };
  const audio = await speak(profile.voice_id, prompt, { model, settings: { ...DEFAULT_SETTINGS[p.line.speaker], ...settings } });
  return storeTake({ ownerId: p.userId, projectId: p.projectId, scriptId: p.scriptId, lineIndex: p.lineIndex, data: audio, mime: "audio/mpeg", ext: "mp3", durationMs: null, source: "ai", aiPrompt: prompt });
}
