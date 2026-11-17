import "server-only";

// ElevenLabs: instant voice clones of the owner (one per character) + expressive text-to-speech.
// Key: ELEVENLABS_API_KEY in Vercel (never in code or chat). Starter plan or higher is needed for cloning.
const API = "https://api.elevenlabs.io/v1";
export const DEFAULT_MODEL = "eleven_v3"; // supports inline delivery tags like [angry] [whispers] [sighs]

export const elevenLabsConfigured = () => Boolean(process.env.ELEVENLABS_API_KEY?.trim());

function key() {
  const k = process.env.ELEVENLABS_API_KEY?.trim();
  if (!k) throw new Error("ELEVENLABS_API_KEY isn't set in Vercel yet.");
  return k;
}

async function fail(res: Response, what: string): Promise<never> {
  let msg = `${res.status}`;
  try {
    const j = (await res.json()) as { detail?: { message?: string; status?: string } | string };
    msg = typeof j.detail === "string" ? j.detail : (j.detail?.message ?? j.detail?.status ?? msg);
  } catch {}
  if (res.status === 401) msg = "the API key was rejected. Check ELEVENLABS_API_KEY in Vercel.";
  if (/quota|credits/i.test(msg)) msg = `not enough ElevenLabs credits left this month (${msg}).`;
  if (/can_not_use_instant_voice_cloning|subscription/i.test(msg)) msg = "voice cloning needs the ElevenLabs Starter plan or higher.";
  throw new Error(`ElevenLabs ${what}: ${msg}`);
}

/** Instant voice clone from short samples (1–2 minutes in total works best). Returns the new voice id. */
export async function cloneVoice(name: string, description: string, samples: { name: string; data: ArrayBuffer; type: string }[]) {
  const form = new FormData();
  form.set("name", name);
  form.set("description", description);
  form.set("remove_background_noise", "true");
  for (const s of samples) form.append("files", new Blob([s.data], { type: s.type }), s.name);
  const res = await fetch(`${API}/voices/add`, { method: "POST", headers: { "xi-api-key": key() }, body: form });
  if (!res.ok) await fail(res, "voice cloning failed");
  return ((await res.json()) as { voice_id: string }).voice_id;
}

export async function voiceExists(voiceId: string) {
  const res = await fetch(`${API}/voices/${voiceId}`, { headers: { "xi-api-key": key() } });
  return res.ok;
}

export type VoiceSettings = { stability?: number; similarity_boost?: number; style?: number; use_speaker_boost?: boolean };

/** Text to speech in the cloned voice. Returns MP3 bytes. */
export async function speak(voiceId: string, text: string, opts: { model?: string; settings?: VoiceSettings; seed?: number } = {}) {
  const res = await fetch(`${API}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key(), "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: opts.model ?? DEFAULT_MODEL,
      voice_settings: opts.settings,
      ...(opts.seed != null ? { seed: opts.seed } : {}),
    }),
  });
  if (!res.ok) await fail(res, "speech failed");
  return res.arrayBuffer();
}
