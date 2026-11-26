import { notFound, renderAuthorized } from "@/lib/render";
import { ownVoicePlan } from "@/lib/render-jobs";
import { voiceModelPath } from "@/lib/renderWorker";
import { rvcModelStatus } from "@/lib/studio-assets";
import { db } from "@/lib/db";
import { signedUrl } from "@/lib/storage";

// GET /api/render/:id/voices → Stage B's work for the render worker: the lines to convert with RVC (signed download
// URL of each line's Gemini take) and short-lived signed URLs of the private voice models (.pth, optional .index).
// The worker never holds database or storage keys; these URLs expire after an hour.
export async function GET(request: Request, ctx: RouteContext<"/api/render/[id]/voices">) {
  if (!renderAuthorized(request)) return notFound();
  const { id } = await ctx.params;
  const plan = await ownVoicePlan(id);
  if (!plan.convert.length) return Response.json({ lines: [], models: {} });
  if (plan.missing.length) return Response.json({ error: `Missing voice model for ${plan.missing.join(", ")}.` }, { status: 409 });
  const ids = plan.convert.map((c) => c.recordingId).filter((x): x is string => Boolean(x));
  const rows = await db()<{ id: string; storage_path: string }[]>`SELECT id, storage_path FROM recordings WHERE id = ANY(${ids})`;
  const pathOf = new Map(rows.map((r) => [r.id, r.storage_path]));
  const status = await rvcModelStatus();
  const models: Record<string, { pth: string; index: string | null }> = {};
  for (const who of [...new Set(plan.convert.map((c) => c.speaker))]) {
    models[who] = {
      pth: await signedUrl(voiceModelPath(who, "pth").path),
      index: status.index[who] ? await signedUrl(voiceModelPath(who, "index").path) : null,
    };
  }
  const lines = await Promise.all(
    plan.convert.map(async (c) => ({ lineIndex: c.lineIndex, speaker: c.speaker, recordingId: c.recordingId, url: await signedUrl(pathOf.get(c.recordingId!)!) })),
  );
  return Response.json({ scriptId: plan.scriptId, lines, models }, { headers: { "Cache-Control": "no-store" } });
}
