import { revalidatePath } from "next/cache";
import { notFound, renderAuthorized } from "@/lib/render";
import { SlotStateError, edgeFinish, propFinish, propGenerate, propPlan, propUpload, edgePlan, edgeUpload, failSlot, finishSlot, scriptSlot, startSlotRender, voiceSlot } from "@/lib/scheduler-server";

export const maxDuration = 300;

// POST /api/scheduler/slots/:id/:step (RENDER_TOKEN), called by the autonomous-scheduler workflow for one slot:
//   script → Gemini writes the script, the episode is created          (scripting → voicing)
//   voice  → voices up to 6 lines; call again until remaining is 0. engine "edge": the worker's Edge TTS takes over
//            (always for Own Voice, and for Gemini TTS slots after a 429 / quota error)
//   prop-plan     → the episode's fresh props still to make (name, prompt)
//   prop-generate → { name } the app generates it (Gemini image model) and returns a URL to the raw image; a failure
//                   drops the prop to none and doesn't fail the slot
//   prop-upload   → { name } a signed upload URL for the cut-out PNG;  prop-finish → { name, ok, error }
//   edge-plan   → the lines without a take, with their TTS text and prosody
//   edge-upload → { lineIndex } a signed upload URL for one Edge TTS take (WAV)
//   edge-finish → { lineIndex, path, durationMs } registers it as the line's selected take
//   render → opens the render job for render.mts / rvc-stage.mts        (voicing → rendering)
//   finish → queues YouTube / Instagram / Facebook, TikTok hand-off     (rendering → ready_to_post | published)
//   fail   → { error, runUrl }                                          (→ failed)
export async function POST(request: Request, ctx: RouteContext<"/api/scheduler/slots/[id]/[step]">) {
  if (!renderAuthorized(request)) return notFound();
  const { id, step } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "Bad slot id." }, { status: 400 });
  const b = (await request.json().catch(() => ({}))) as { error?: string; runUrl?: string; lineIndex?: number; path?: string; durationMs?: number; name?: string; ok?: boolean };
  try {
    let out: unknown;
    if (step === "script") out = await scriptSlot(id, b.runUrl ?? null);
    else if (step === "voice") out = await voiceSlot(id);
    else if (step === "prop-plan") out = await propPlan(id);
    else if (step === "prop-generate") out = await propGenerate(id, String(b.name ?? ""), new URL(request.url).origin);
    else if (step === "prop-upload") out = await propUpload(id, String(b.name ?? ""));
    else if (step === "prop-finish") out = await propFinish(id, String(b.name ?? ""), b.ok === true, typeof b.error === "string" ? b.error : undefined);
    else if (step === "edge-plan") out = await edgePlan(id);
    else if (step === "edge-upload") out = await edgeUpload(id, Number(b.lineIndex));
    else if (step === "edge-finish") out = await edgeFinish(id, { lineIndex: Number(b.lineIndex), path: String(b.path ?? ""), durationMs: typeof b.durationMs === "number" ? b.durationMs : null });
    else if (step === "render") out = await startSlotRender(id);
    else if (step === "finish") out = await finishSlot(id);
    else if (step === "fail") out = (await failSlot(id, String(b.error ?? "The worker failed. Open the run on GitHub for the log.").slice(0, 1000), b.runUrl ?? null), { ok: true });
    else return notFound();
    revalidatePath("/schedule");
    return Response.json(out);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[scheduler] slot ${id} ${step} failed: ${message}`);
    // a call for a slot in another state (late / duplicate worker) changes nothing; any other failure fails the slot
    // right away, with the reason the Schedule page shows
    if (e instanceof SlotStateError) return Response.json({ error: message }, { status: 409 });
    if (step !== "fail") await failSlot(id, message, b.runUrl ?? null).catch(() => {});
    revalidatePath("/schedule");
    return Response.json({ error: message }, { status: 422 });
  }
}
