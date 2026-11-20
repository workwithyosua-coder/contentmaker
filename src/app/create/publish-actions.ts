"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { approveWithoutAi } from "@/lib/publish/approval";
import { PUBLISH_PLATFORMS, type PublishPlatform } from "@/lib/publish/captions";
import { captionProblems } from "@/lib/publish/manualCaptions";
import { getOwner } from "@/lib/queries";
import type { StepResult } from "./actions";

// Approval without AI, caption edits and social publishing. Plain code and SQL only: nothing in this file's import
// graph reaches the writers' room or the Anthropic client (tests/unit/zero-ai-publishing.test.mts checks it), so all
// of it works with a $0 Anthropic balance.

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function account() {
  const o = await getOwner();
  if (!o) throw new Error("No user found.");
  return o;
}

/** "Approve without AI (write captions myself)": approves the latest script and fills editable default captions. */
export async function approveWithoutAiAction(projectId: string): Promise<StepResult> {
  try {
    const o = await account();
    const r = await approveWithoutAi({ userId: o.id, projectId });
    revalidatePath(`/create/${projectId}`);
    revalidatePath("/create");
    return {
      ok: true,
      message: r.wroteCaptions
        ? `Script v${r.version} approved. Default captions are filled in below: edit them before posting.`
        : `Script v${r.version} approved. Your captions are unchanged.`,
    };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** Publish panel: post now / schedule / retry failed / cancel the schedule, with the panel's per-platform settings. */
export async function publishAction(projectId: string, _prev: StepResult, form: FormData): Promise<StepResult> {
  try {
    const o = await account();
    const { handlePublish } = await import("@/lib/publish/requests");
    const mode = String(form.get("mode") ?? "now") as "now" | "schedule" | "retry" | "cancel";
    const settings: Record<string, Record<string, unknown>> = {};
    for (const p of PUBLISH_PLATFORMS) {
      if (!form.has(`${p}.present`)) continue; // only platforms shown in the panel
      const flag = (k: string) => form.get(`${p}.${k}`) === "on";
      const str = (k: string) => (form.get(`${p}.${k}`) as string | null)?.trim() || undefined;
      settings[p] = {
        enabled: flag("enabled"),
        title: str("title"),
        text: str("text"),
        privacy: str("privacy"),
        allowComments: flag("allowComments"),
        allowDuet: flag("allowDuet"),
        allowStitch: flag("allowStitch"),
        shareToFeed: flag("shareToFeed"),
        coverSecond: Number(form.get(`${p}.coverSecond`)) || 1,
        discloseContent: flag("discloseContent"),
        brandOrganic: flag("brandOrganic"),
        brandContent: flag("brandContent"),
      };
    }
    if (mode === "now" || mode === "schedule") {
      // a switched-on platform with a blank required title / caption is never posted with an empty field
      const problems = captionProblems(
        Object.fromEntries(
          (Object.entries(settings) as [PublishPlatform, Record<string, unknown>][]).map(([p, s]) => [
            p,
            { enabled: Boolean(s.enabled), title: (s.title as string) ?? "", text: (s.text as string) ?? "" },
          ]),
        ),
      );
      if (problems.length) return { ok: false, message: problems.map((x) => x.message).join(" ") };
      // TikTok's posting rules: the creator picks the audience (no default); disclosure needs a choice;
      // branded content can't be private.
      const tt = settings.tiktok;
      if (tt?.enabled) {
        if (!tt.privacy) return { ok: false, message: "TikTok: choose who can watch." };
        if (tt.discloseContent && !tt.brandOrganic && !tt.brandContent) {
          return { ok: false, message: "TikTok: you switched on content disclosure; choose Your brand, Branded content, or both." };
        }
        if (tt.brandContent && tt.privacy === "SELF_ONLY") return { ok: false, message: "TikTok: branded content can't be posted as Only me." };
      }
    }
    // the schedule picker is WIB (Asia/Jakarta, UTC+7, no daylight saving)
    const local = String(form.get("at") ?? "");
    const at = local ? `${local}:00+07:00` : null;
    const r = await handlePublish(o.id, projectId, { mode, at, settings: mode === "cancel" ? undefined : settings });
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: r.message };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** "Auto-post on render complete" switch. */
export async function setAutoPublishAction(projectId: string, on: boolean): Promise<StepResult> {
  try {
    const o = await account();
    await db()`UPDATE content_projects SET auto_publish = ${on} WHERE id = ${projectId} AND user_id = ${o.id}`;
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: on ? "New renders will be posted automatically." : "Auto-post is off." };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}
