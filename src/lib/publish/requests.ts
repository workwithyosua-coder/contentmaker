import "server-only";
import { after } from "next/server";
import { cancelScheduled, drain, queuePublish, type PublishSettings } from "./engine";

export type PublishRequest = { mode: "now" | "schedule" | "retry" | "cancel"; at?: string | null; settings?: PublishSettings };

/** Shared by the publish panel (server action) and POST /api/episodes/:id/publish. Never waits for uploads. */
export async function handlePublish(userId: string, projectId: string, r: PublishRequest) {
  if (r.mode === "cancel") {
    await cancelScheduled(projectId);
    return { message: "Scheduled post cancelled." };
  }
  let at: Date | null = null;
  if (r.mode === "schedule") {
    at = r.at ? new Date(r.at) : null;
    if (!at || Number.isNaN(at.getTime())) throw new Error("Pick a date and time.");
    if (at.getTime() < Date.now() + 60_000) throw new Error("Pick a time at least a minute from now.");
  }
  const queued = await queuePublish({ userId, projectId, at, onlyFailed: r.mode === "retry", settings: r.settings });
  if (!queued.length) {
    throw new Error(r.mode === "retry" ? "Nothing failed, so nothing to retry." : "Nothing to post: every enabled platform is already published or in progress.");
  }
  if (r.mode !== "schedule") after(() => drain().catch((e) => console.error("[publish] drain failed:", e)));
  const names = queued.join(", ");
  return {
    message:
      r.mode === "schedule"
        ? `Scheduled for ${at!.toLocaleString("en-GB", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })} WIB: ${names}.`
        : `Publishing to ${names}. This page updates as each one finishes.`,
  };
}
