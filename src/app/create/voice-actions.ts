"use server";

import { revalidatePath } from "next/cache";
import { getOwner } from "@/lib/queries";
import { PROVIDER_LABEL, DELIVERY_LABEL, asPreset, asProvider, type DeliveryPreset, type VoiceProvider } from "@/lib/voice/acting";
import { setEpisodeVoice } from "@/lib/voice/settings";

/** Saves an episode's voice provider and delivery preset. Nothing is re-voiced: existing takes stay. */
export async function setEpisodeVoiceAction(projectId: string, provider: VoiceProvider, preset: DeliveryPreset) {
  try {
    const o = await getOwner();
    if (!o) return { ok: false, message: "No user found." };
    await setEpisodeVoice(o.id, projectId, { provider: asProvider(provider), preset: asPreset(preset) });
    revalidatePath(`/create/${projectId}`);
    revalidatePath(`/create/${projectId}/record`);
    return { ok: true, message: `Saved: ${PROVIDER_LABEL[asProvider(provider)]}, ${DELIVERY_LABEL[asPreset(preset)]}. Lines that already have audio keep it.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
