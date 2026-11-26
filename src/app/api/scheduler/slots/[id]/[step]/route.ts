import { revalidatePath } from "next/cache";
import { notFound, renderAuthorized } from "@/lib/render";
import { failSlot, finishSlot, scriptSlot, startSlotRender, voiceSlot } from "@/lib/scheduler-server";

export const maxDuration = 300;

// POST /api/scheduler/slots/:id/:step (RENDER_TOKEN), called by the autonomous-scheduler workflow for one slot:
//   script → Gemini writes the script, the episode is created          (scripting → voicing)
//   voice  → voices up to 6 lines; call again until remaining is 0
//   render → opens the render job for render.mts / rvc-stage.mts        (voicing → rendering)
//   finish → queues YouTube / Instagram / Facebook, TikTok hand-off     (rendering → ready_to_post | published)
//   fail   → { error, runUrl }                                          (→ failed)
export async function POST(request: Request, ctx: RouteContext<"/api/scheduler/slots/[id]/[step]">) {
  if (!renderAuthorized(request)) return notFound();
  const { id, step } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "Bad slot id." }, { status: 400 });
  const b = (await request.json().catch(() => ({}))) as { error?: string; runUrl?: string };
  try {
    let out: unknown;
    if (step === "script") out = await scriptSlot(id, b.runUrl ?? null);
    else if (step === "voice") out = await voiceSlot(id);
    else if (step === "render") out = await startSlotRender(id);
    else if (step === "finish") out = await finishSlot(id);
    else if (step === "fail") out = (await failSlot(id, String(b.error ?? "The worker failed. Open the run on GitHub for the log.").slice(0, 1000), b.runUrl ?? null), { ok: true });
    else return notFound();
    revalidatePath("/schedule");
    return Response.json(out);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[scheduler] slot ${id} ${step} failed: ${message}`);
    // a step that can't go on fails the slot right away, with the reason the Schedule page shows
    if (step !== "fail") await failSlot(id, message, b.runUrl ?? null).catch(() => {});
    revalidatePath("/schedule");
    return Response.json({ error: message }, { status: 422 });
  }
}
