"use server";

import { revalidatePath } from "next/cache";
import {
  addOverride,
  deleteLesson,
  editLesson,
  logTikTokMetrics,
  removeOverride,
  resetTunables,
  saveReview,
  saveTunables,
  setLessonStatus,
  type ReviewResult,
} from "@/lib/insights/server";
import { TUNABLE_KEYS, type Tunables } from "@/lib/insights/tunables";

// The Showrunner Playbook's server actions: the Director's Review on an episode page, and the four sections of
// /insights. Every page that calls these is behind the owner password (src/proxy.ts). No Anthropic call anywhere:
// rules are distilled with Gemini (insights/server.ts).

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };
const fail = (e: unknown): { ok: false; message: string } => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

export async function saveReviewAction(
  episodeId: string,
  input: { rating: string | null; tags: string[]; notes: string; term: string; spokenAs: string },
): Promise<ReviewResult | { ok: false; message: string }> {
  try {
    const r = await saveReview({ episodeId, rating: input.rating, tags: input.tags, notes: input.notes, term: input.term, spokenAs: input.spokenAs });
    revalidatePath("/insights");
    return r;
  } catch (e) {
    return fail(e);
  }
}

export async function logTikTokAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const episodeId = String(form.get("episodeId") ?? "");
    if (!/^[0-9a-f-]{36}$/.test(episodeId)) throw new Error("Pick the episode these numbers are for.");
    const score = await logTikTokMetrics({
      episodeId,
      views: form.get("views"),
      likes: form.get("likes"),
      comments: form.get("comments"),
      shares: form.get("shares"),
      saves: form.get("saves"),
      postId: String(form.get("postId") ?? ""),
    });
    revalidatePath("/insights");
    return { ok: true, message: `TikTok metrics saved. Engagement score ${score}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function setLessonStatusAction(id: string, status: "active" | "paused"): Promise<ActionResult> {
  try {
    await setLessonStatus(id, status === "active" ? "active" : "paused");
    revalidatePath("/insights");
    return { ok: true, message: status === "active" ? "Rule resumed." : "Rule paused." };
  } catch (e) {
    return fail(e);
  }
}

export async function editLessonAction(id: string, ruleText: string, category: string): Promise<ActionResult> {
  try {
    await editLesson(id, ruleText, category);
    revalidatePath("/insights");
    return { ok: true, message: "Rule updated." };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteLessonAction(id: string): Promise<ActionResult> {
  try {
    await deleteLesson(id);
    revalidatePath("/insights");
    return { ok: true, message: "Rule deleted." };
  } catch (e) {
    return fail(e);
  }
}

export async function saveTunablesAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    if (form.get("intent") === "reset") {
      await resetTunables();
      revalidatePath("/insights");
      return { ok: true, message: "Tunables reset to the defaults." };
    }
    const raw = Object.fromEntries(TUNABLE_KEYS.map((k) => [k, form.get(k)])) as Partial<Record<keyof Tunables, unknown>>;
    const saved = await saveTunables(raw);
    const clamped = TUNABLE_KEYS.filter((k) => raw[k] != null && String(raw[k]).trim() !== "" && Number(raw[k]) !== saved[k]);
    revalidatePath("/insights");
    return { ok: true, message: clamped.length ? `Tunables saved. Kept inside the allowed range: ${clamped.join(", ")}.` : "Tunables saved. The next episode uses them." };
  } catch (e) {
    return fail(e);
  }
}

export async function addPronunciationAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const r = await addOverride(String(form.get("term") ?? ""), String(form.get("spokenAs") ?? ""));
    revalidatePath("/insights");
    return { ok: true, message: `"${r.term}" is now spoken as "${r.spoken_as}".` };
  } catch (e) {
    return fail(e);
  }
}

export async function removePronunciationAction(term: string): Promise<ActionResult> {
  try {
    await removeOverride(term);
    revalidatePath("/insights");
    return { ok: true, message: `Removed "${term}".` };
  } catch (e) {
    return fail(e);
  }
}
