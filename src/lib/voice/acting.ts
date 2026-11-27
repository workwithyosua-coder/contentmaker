// Voice providers and the acting direction they get. Pure code (no network, no server-only imports): the pickers,
// the server and the unit tests share it. The script text itself is never changed: a provider gets the line exactly
// as written, plus a separate acting direction derived from the line's pose and the episode's delivery preset.
import { FADE_OUT_S, speechEndSeconds } from "../../../video/src/audioChain";
import { ttsText } from "./phonetic";

export const VOICE_PROVIDERS = ["gemini_tts", "elevenlabs", "gemini_tts_rvc"] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];
/** Providers the pickers offer. Own Voice = Gemini TTS acting, converted to the user's voice by the RVC worker. */
export const SELECTABLE_PROVIDERS: readonly VoiceProvider[] = ["gemini_tts", "elevenlabs", "gemini_tts_rvc"];
export const DEFAULT_PROVIDER: VoiceProvider = "gemini_tts";
export const PROVIDER_LABEL: Record<VoiceProvider, string> = {
  gemini_tts: "Gemini TTS (Free)",
  elevenlabs: "ElevenLabs",
  gemini_tts_rvc: "Own Voice (Gemini + RVC)",
};

export const asProvider = (v: unknown): VoiceProvider => (VOICE_PROVIDERS as readonly string[]).includes(String(v)) ? (v as VoiceProvider) : DEFAULT_PROVIDER;

export const DELIVERY_PRESETS = ["standard", "angry"] as const;
export type DeliveryPreset = (typeof DELIVERY_PRESETS)[number];
export const DELIVERY_LABEL: Record<DeliveryPreset, string> = { standard: "Standard", angry: "Angry / Urgent" };
export const asPreset = (v: unknown): DeliveryPreset => (v === "angry" ? "angry" : "standard");

/** Gemini's built-in voices: Uco energetic and expressive, Ocu deeper and sharper. */
export const GEMINI_VOICES: Record<"uco" | "ocu", string> = { uco: "Puck", ocu: "Charon" };

/** Indonesian acting direction per pose (Uco & Ocu comic banter). */
export const POSE_DIRECTION: Record<string, string> = {
  angry: "cepat, geram, keras, dan kesal: omelan bahasa Indonesia yang meledak-ledak dengan penekanan tajam",
  deadpan: "datar, kering, dan menyindir: sarkas deadpan dengan ejekan halus",
  defensive: "gelagapan dan defensif: membela diri dengan cepat",
  inspecting: "tajam dan menyelidik: menunjukkan fakta keras satu per satu",
  thought: "lebih pelan dan lirih: bergumam kering pada diri sendiri, tidak percaya",
  shocked: "kaget dan heboh: energi tinggi ala banter komedi",
  explaining: "yakin dan bersemangat: menjelaskan dengan energi tinggi ala banter komedi",
  cta: "akrab dan bersemangat: ajakan penutup ala banter komedi",
  triumphant: "menang dan percaya diri: energi tinggi ala banter komedi",
  phone: "heboh sambil lihat HP: energi tinggi ala banter komedi",
};

type ActingLine = { speaker: "uco" | "ocu"; emotion?: string | null; expression?: string | null; thought_bubble?: boolean | null };

/** The pose that drives the acting: a thought first, then the line's pose, then its expression, then the character's usual. */
export function actingPose(l: ActingLine): string {
  if (l.thought_bubble) return "thought";
  const pose = String(l.emotion ?? "").toLowerCase();
  if (POSE_DIRECTION[pose]) return pose;
  const e = String(l.expression ?? "").toLowerCase();
  if (e === "angry" || e === "furious") return "angry";
  if (e === "deadpan" || e === "calm" || e === "smug") return "deadpan";
  if (e === "shocked" || e === "worried") return "shocked";
  return l.speaker === "uco" ? "triumphant" : "deadpan";
}

/**
 * The acting direction for one line, in Indonesian: the pose's direction, made more urgent under the Angry / Urgent
 * preset (except inner thoughts, which stay muttered), plus an optional extra note from the booth.
 */
export function actingDirection(l: ActingLine, preset: DeliveryPreset = "standard", extra?: string | null): string {
  const pose = actingPose(l);
  const parts = [POSE_DIRECTION[pose]];
  if (preset === "angry" && pose !== "thought") parts.push(pose === "angry" ? "naikkan urgensinya: ini darurat" : "dengan nada mendesak dan urgen");
  const note = (extra ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (note) parts.push(note);
  return parts.join("; ");
}

/**
 * The delivery style per pose for gemini-3.8-flash-tts's `speechMetadata.style` (never spoken). Gemini's TTS models
 * read `parts[].text` verbatim, so the acting cue lives here and only the dialogue goes in the text.
 */
export const POSE_STYLE: Record<string, string> = {
  angry: "Outraged Jakartan Indonesian rant, loud, sharp emphasis",
  deadpan: "Deadpan sarcastic Jakartan Indonesian, dry flat delivery",
  defensive: "Flustered, defensive Jakartan Indonesian, quick self-justification",
  inspecting: "Sharp, probing Jakartan Indonesian, laying out hard facts one by one",
  thought: "Quiet dry mutter to oneself, disbelieving, Jakartan Indonesian",
  shocked: "Shocked, high-energy Jakartan Indonesian comedy banter",
  explaining: "Confident, energetic Jakartan Indonesian explanation",
  cta: "Warm, upbeat Jakartan Indonesian sign-off",
  triumphant: "Energetic Jakartan Indonesian comedy banter, confident and challenging",
  phone: "Excited Jakartan Indonesian, reacting to a phone screen",
};

/**
 * The speed every spoken line asks for, both characters: natural conversational speed. Energy comes from the tone,
 * never from speed (the first natural-pacing review found the episode rushed).
 */
export const NATURAL_PACE = "natural, conversational Indonesian speaking speed, expressive and witty in tone, not rushed or rapid-fire";
/** Ocu, on top: crisp and steady, without dragging (no slow pauses or stretched syllables). */
export const OCU_PACE = "crisp and steady, clear enunciation, no drawn-out pauses or stretched syllables";
/** Added when the line says the show's handle. */
export const HANDLE_DICTION = 'say the names "Uco Ocu" the Indonesian way, "OO-cho OH-chu" (c as in "ch", never "k"), both names distinct';

/** Instruction text that must never be spoken: the old prompt's phrases and any inline style label. */
export const INSTRUCTION_IN_TEXT = /\bbacakan dalam\b|\bucapkan persis\b|\btanpa menambah atau mengubah\b|\bstyle\s*:|\bspeak (this|the following)\b/i;

/** Throws when a TTS text carries acting instructions (the runtime guard before any TTS request). */
export function assertSpokenOnly(text: string): string {
  if (INSTRUCTION_IN_TEXT.test(text)) throw new Error(`Refusing to send acting instructions as spoken TTS text: "${text.slice(0, 80)}"`);
  return text;
}

/**
 * One Gemini TTS request's two halves: `text` is ONLY the line to speak, exactly as written (phonetic fixes applied:
 * "&" → "dan", "@uco.ocu" → "Ucho Ochu": Gemini reads "Uco" as "Uko"); `style` is the pose's delivery, more urgent under the Angry /
 * Urgent preset (inner thoughts stay muttered), plus an optional booth note. `style` goes in speechMetadata, never in
 * the text.
 */
export function geminiSpeech(l: ActingLine & { text: string }, preset: DeliveryPreset = "standard", extra?: string | null): { text: string; style: string } {
  const pose = actingPose(l);
  const text = assertSpokenOnly(ttsText(l.text, "gemini"));
  const parts = [POSE_STYLE[pose] ?? POSE_STYLE.triumphant];
  // natural speed for both (energy is in the tone); Ocu also crisp and steady, never dragging
  if (pose !== "thought") parts.push(NATURAL_PACE);
  if (l.speaker === "ocu" && pose !== "thought") parts.push(OCU_PACE);
  if (preset === "angry" && pose !== "thought") parts.push("urgent, pressing");
  // the outro handle: every syllable of "Ucho Ochu" said clearly
  if (/Ucho Ochu/.test(text)) parts.push(HANDLE_DICTION);
  const note = (extra ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (note) parts.push(note);
  return { text, style: parts.join("; ").slice(0, 400) };
}

/** The generateContent body for one line: the verbatim dialogue in parts[0].text, the acting cue in speechMetadata.style. */
export function ttsRequestBody(text: string, style: string, speaker: "uco" | "ocu") {
  if (!style.trim()) throw new Error("A Gemini TTS request needs a delivery style (speechMetadata.style).");
  return {
    contents: [{ role: "user", parts: [{ text: assertSpokenOnly(text), speechMetadata: { style } }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICES[speaker] } } },
    },
  };
}

/** 16-bit little-endian PCM (Gemini's audio) → a WAV file the booth, the preview and the renderer all play. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000, channels = 1): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/**
 * Stage A's take, cleaned before it's stored (and before RVC sees it): whole 16-bit samples only (a stray odd byte
 * would shift every sample after it), everything after the last real speech cut (Gemini's trailing "tsk" click, see
 * speechEndSeconds), and a 40 ms fade to zero on the new last edge.
 */
export function cleanPcmTail(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const even = pcm.subarray(0, pcm.length - (pcm.length % 2));
  const samples = new Int16Array(even.buffer.slice(even.byteOffset, even.byteOffset + even.length));
  const keep = Math.min(samples.length, Math.round(speechEndSeconds(samples, sampleRate) * sampleRate));
  const out = samples.slice(0, keep);
  const fade = Math.min(keep, Math.round(FADE_OUT_S * sampleRate));
  for (let i = 0; i < fade; i++) out[keep - fade + i] = Math.round(out[keep - fade + i] * (1 - (i + 1) / fade));
  return new Uint8Array(out.buffer);
}

/** Length of a 16-bit WAV made by pcmToWav, in ms. */
export function wavDurationMs(wav: Uint8Array): number {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const bytesPerSecond = v.getUint32(28, true) || 48000;
  return Math.round(((wav.byteLength - 44) / bytesPerSecond) * 1000);
}

/** Sample rate from Gemini's audio MIME type ("audio/L16;codec=pcm;rate=24000"), else 24 kHz. */
export const pcmRate = (mime: string | null | undefined) => Number(/rate=(\d+)/.exec(mime ?? "")?.[1]) || 24000;

/**
 * Which lines a "voice the missing lines" run generates: only lines without a selected take. A line that already has
 * audio (recorded, uploaded or AI, cached in Storage) is never sent to a provider again, whatever changed since
 * (cues, poses, props, style, BGM, the provider choice). Only an explicit "redo this line" makes a new take.
 */
export function linesToVoice<L extends { index: number }>(lines: L[], hasTake: (index: number) => boolean, mode: "missing" | "line", lineIndex?: number): L[] {
  if (mode === "line") return lines.filter((l) => l.index === lineIndex);
  return lines.filter((l) => !hasTake(l.index));
}

export type VoiceRoute = { ok: true; engine: "gemini" | "elevenlabs"; rvc?: boolean } | { ok: false; message: string; href?: string };

/** Where missing Own-Voice models are uploaded. */
export const STUDIO_ASSETS_HREF = "/accounts#studio-assets";

/**
 * Which engine voices a line for the chosen provider, or why it can't (shown in the booth instead of crashing):
 * Gemini needs GEMINI_API_KEY; ElevenLabs needs its key and both cloned voices; Own Voice needs Gemini for the acted
 * base take and the speaking character's .pth model (never a silent fallback to Gemini's or ElevenLabs' voice).
 */
export function routeVoice(
  provider: VoiceProvider,
  env: { geminiKey: boolean; elevenLabsKey: boolean; elevenLabsVoices: boolean; rvcModels?: { uco: boolean; ocu: boolean } },
  speakers: ("uco" | "ocu")[] = ["uco", "ocu"],
): VoiceRoute {
  if (provider === "gemini_tts") return env.geminiKey ? { ok: true, engine: "gemini" } : { ok: false, message: "GEMINI_API_KEY is not set in environment variables." };
  if (provider === "elevenlabs") {
    if (!env.elevenLabsKey) return { ok: false, message: "ELEVENLABS_API_KEY isn't set in Vercel yet. Switch the voice provider to Gemini TTS (Free)." };
    if (!env.elevenLabsVoices) return { ok: false, message: "Clone Uco's and Ocu's voices on the Create page first, or switch to Gemini TTS (Free)." };
    return { ok: true, engine: "elevenlabs" };
  }
  // gemini_tts_rvc
  const missing = speakers.filter((w) => !env.rvcModels?.[w]);
  if (missing.length) {
    const names = missing.map((w) => `${w === "uco" ? "Uco" : "Ocu"} (${w}-voice.pth)`).join(" and ");
    return { ok: false, message: `Own Voice needs ${missing.length > 1 ? "voice models" : "a voice model"} for ${names}. Upload ${missing.length > 1 ? "them" : "it"} in Accounts → Studio Assets.`, href: STUDIO_ASSETS_HREF };
  }
  if (!env.geminiKey) return { ok: false, message: "GEMINI_API_KEY is not set in environment variables." };
  return { ok: true, engine: "gemini", rvc: true };
}
