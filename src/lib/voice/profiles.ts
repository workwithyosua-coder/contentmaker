import "server-only";
import { db } from "../db";
import { getObject } from "../storage";
import { DEFAULT_SETTINGS } from "./direction";
import { cloneVoice, type VoiceSettings } from "./elevenlabs";

export type Speaker = "uco" | "ocu";
export type VoiceProfile = { speaker: Speaker; voice_id: string; name: string | null; settings: VoiceSettings & { model?: string }; created_at: Date };

export async function getVoiceProfiles(userId: string) {
  const rows = await db()<VoiceProfile[]>`
    SELECT speaker, voice_id, name, settings, created_at FROM voice_profiles WHERE user_id = ${userId} AND provider = 'elevenlabs'`;
  return Object.fromEntries(rows.map((r) => [r.speaker, r])) as Partial<Record<Speaker, VoiceProfile>>;
}

export async function setVoiceProfile(userId: string, speaker: Speaker, voiceId: string, name: string) {
  await db()`
    INSERT INTO voice_profiles (user_id, speaker, voice_id, name, settings)
    VALUES (${userId}, ${speaker}, ${voiceId}, ${name}, ${db().json(DEFAULT_SETTINGS[speaker] as never)})
    ON CONFLICT (user_id, speaker) DO UPDATE SET voice_id = EXCLUDED.voice_id, name = EXCLUDED.name, updated_at = now()`;
}

/** Recorded (not AI) takes of one character, newest first, about 2.5 minutes at most: the clone's samples. */
export async function cloneSamples(userId: string, speaker: Speaker) {
  const rows = await db()<{ storage_path: string; mime_type: string; duration_ms: number | null }[]>`
    SELECT r.storage_path, r.mime_type, r.duration_ms FROM recordings r JOIN content_projects p ON p.id = r.project_id
    WHERE p.user_id = ${userId} AND r.speaker = ${speaker} AND r.source IN ('booth', 'upload') AND r.is_selected
    ORDER BY r.created_at DESC LIMIT 25`;
  const picked: { storage_path: string; mime_type: string; duration_ms: number | null }[] = [];
  let total = 0;
  for (const r of rows) {
    if (total > 150_000) break;
    picked.push(r);
    total += r.duration_ms ?? 8000;
  }
  return { rows: picked, seconds: Math.round(total / 1000) };
}

export async function cloneFromTakes(userId: string, speaker: Speaker) {
  const { rows, seconds } = await cloneSamples(userId, speaker);
  if (rows.length < 2 || seconds < 20) throw new Error(`Record at least 20 seconds of ${speaker.toUpperCase()} lines in the booth first.`);
  const samples = [];
  for (const [i, r] of rows.entries()) {
    const data = await getObject(r.storage_path);
    if (data) samples.push({ name: `${speaker}-${i + 1}.${r.storage_path.split(".").pop()}`, data, type: r.mime_type });
  }
  const name = speaker === "uco" ? "Uco (Dapur Konten)" : "Ocu (Dapur Konten)";
  const desc =
    speaker === "uco"
      ? "Uco: loud, fast, over-optimistic, gets angry at stupidity. Casual Jakarta Indonesian."
      : "Ocu: calm, slow, deadpan, pessimistic. Casual Jakarta Indonesian.";
  const voiceId = await cloneVoice(name, desc, samples);
  await setVoiceProfile(userId, speaker, voiceId, name);
  return { voiceId, samples: samples.length, seconds };
}
