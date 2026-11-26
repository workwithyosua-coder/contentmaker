// Voice providers and the acting direction they get. Pure code (no network, no server-only imports): the pickers,
// the server and the unit tests share it. The script text itself is never changed: a provider gets the line exactly
// as written, plus a separate acting direction derived from the line's pose and the episode's delivery preset.

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
 * The prompt Gemini TTS reads: an instruction line (not spoken) and the line itself, exactly as written in the script.
 * Gemini speaks only the quoted text and follows the instruction for delivery.
 */
export function geminiPrompt(l: ActingLine & { text: string }, preset: DeliveryPreset = "standard", extra?: string | null): string {
  return `Bacakan dalam bahasa Indonesia gaul Jakarta dengan gaya ${actingDirection(l, preset, extra)}. Ucapkan persis kalimat ini saja, tanpa menambah atau mengubah kata:\n${l.text}`;
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
