import "server-only";
import { db } from "../db";
import { asPreset, asProvider, type DeliveryPreset, type VoiceProvider } from "./acting";

// Per-episode voice settings (content_projects.voice_provider / delivery_preset, migration 017). Read through
// to_jsonb so an app deployed before the migration is applied still works with the defaults (Gemini TTS, Standard).

export type VoiceSettings = { provider: VoiceProvider; preset: DeliveryPreset };

export async function getEpisodeVoice(projectId: string): Promise<VoiceSettings> {
  const [r] = await db()<{ p: string | null; d: string | null }[]>`
    SELECT to_jsonb(c) ->> 'voice_provider' AS p, to_jsonb(c) ->> 'delivery_preset' AS d FROM content_projects c WHERE id = ${projectId}`;
  return { provider: asProvider(r?.p), preset: asPreset(r?.d) };
}

/** Saves an episode's voice settings. A clear message (not a crash) when migration 017 isn't applied yet. */
export async function setEpisodeVoice(userId: string, projectId: string, v: Partial<VoiceSettings>) {
  const sql = db();
  try {
    if (v.provider) await sql`UPDATE content_projects SET voice_provider = ${asProvider(v.provider)} WHERE id = ${projectId} AND user_id = ${userId}`;
    if (v.preset) await sql`UPDATE content_projects SET delivery_preset = ${asPreset(v.preset)} WHERE id = ${projectId} AND user_id = ${userId}`;
  } catch (e) {
    if (/voice_provider|delivery_preset/.test(String(e))) throw new Error("Voice settings need database migration 017 (voice provider). Apply it, then try again.");
    throw e;
  }
}
