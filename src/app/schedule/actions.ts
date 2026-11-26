"use server";

import { revalidatePath } from "next/cache";
import { getOwner } from "@/lib/queries";
import { dispatchSlot, regenerateSlot, retrySlot, savePropTags, saveSchedule, setSeed, setSeeds } from "@/lib/scheduler-server";
import { isPropName } from "../../../video/src/props/library";
import { parseKeywords, type ScheduleRule } from "@/lib/scheduler";

// The Schedule page: the rule, the queue (seeds, run now, retry) and the Prop Bank tags. Plain code, no AI.

export type Result = { ok: boolean; message: string } | null;
const fail = (e: unknown): Result => ({ ok: false, message: e instanceof Error ? (/episode_queue|content_schedules|prop_bank/.test(e.message) && /does not exist/.test(e.message) ? "The scheduler needs database migration 018. Apply it, then try again." : e.message) : String(e) });

async function owner() {
  const o = await getOwner();
  if (!o) throw new Error("No user found.");
  return o;
}

export async function saveScheduleAction(rule: Partial<Record<keyof ScheduleRule, unknown>>): Promise<Result> {
  try {
    const o = await owner();
    const s = await saveSchedule(o.id, rule);
    revalidatePath("/schedule");
    return { ok: true, message: `Saved: ${s.slots_per_day} episodes a day at ${s.slot_times.join(" and ")} WIB${s.auto_execute ? ", auto-execute on" : ", auto-execute off"}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function setSeedsAction(_prev: Result, form: FormData): Promise<Result> {
  try {
    const o = await owner();
    const n = await setSeeds(o.id, String(form.get("seeds") ?? "").slice(0, 10000));
    revalidatePath("/schedule");
    return n ? { ok: true, message: `${n} topic${n > 1 ? "s" : ""} added to the next open slots.` } : { ok: false, message: "No open slots to fill (or no topics typed)." };
  } catch (e) {
    return fail(e);
  }
}

export async function setSeedAction(id: string, seed: string): Promise<Result> {
  try {
    const o = await owner();
    await setSeed(o.id, id, seed);
    revalidatePath("/schedule");
    return { ok: true, message: seed.trim() ? "Topic saved." : "Topic cleared: Gemini suggests one." };
  } catch (e) {
    return fail(e);
  }
}

export async function runSlotAction(id: string): Promise<Result> {
  try {
    const o = await owner();
    await dispatchSlot(o.id, id);
    revalidatePath("/schedule"); // the card's Starting bar and the 4 s polling show right away
    return { ok: true, message: "Started on GitHub. The status updates as each step finishes (a few minutes)." };
  } catch (e) {
    return fail(e);
  }
}

export async function retrySlotAction(id: string): Promise<Result> {
  try {
    const o = await owner();
    const r = await retrySlot(o.id, id);
    // a slot back in the queue runs right away (Starting bar from this click) when the dispatch token is set
    if (r === "queued" && process.env.GITHUB_DISPATCH_TOKEN?.trim()) {
      await dispatchSlot(o.id, id);
      revalidatePath("/schedule");
      return { ok: true, message: "Retrying on GitHub now. The bar shows each step as it finishes." };
    }
    revalidatePath("/schedule");
    return { ok: true, message: r === "posting" ? "Posting the failed platforms again." : "Back in the queue. Tap Run slot now, or the next scheduled run picks it up." };
  } catch (e) {
    return fail(e);
  }
}

export async function savePropAction(name: string, keywords: string, vetted: boolean, category: string): Promise<Result> {
  try {
    const o = await owner();
    if (!isPropName(name)) return { ok: false, message: "Unknown prop." };
    const tags = parseKeywords(keywords);
    await savePropTags(o.id, name, tags, vetted, category.trim().slice(0, 40) || null);
    revalidatePath("/schedule");
    return { ok: true, message: vetted ? `Saved ${tags.length} tag${tags.length === 1 ? "" : "s"}.` : "Saved. Unattended scripts won't use this prop." };
  } catch (e) {
    return fail(e);
  }
}

/** Throws the slot's draft episode away and runs the slot again with a fresh script (or queues it without the token). */
export async function regenerateSlotAction(id: string): Promise<Result> {
  try {
    const o = await owner();
    await regenerateSlot(o.id, id);
    revalidatePath("/schedule");
    if (!process.env.GITHUB_DISPATCH_TOKEN?.trim()) return { ok: true, message: "Draft deleted, slot back in the queue. The next scheduled run writes a fresh script." };
    await dispatchSlot(o.id, id);
    revalidatePath("/schedule");
    return { ok: true, message: "Draft deleted. A fresh script is being written on GitHub now." };
  } catch (e) {
    return fail(e);
  }
}
