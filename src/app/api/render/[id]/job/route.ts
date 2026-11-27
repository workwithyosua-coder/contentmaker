import { revalidatePath } from "next/cache";
import { notFound, renderAuthorized } from "@/lib/render";
import { parseJobReport, serverError } from "@/lib/render-manifest";
import { updateRenderJob } from "@/lib/render-jobs";

// POST /api/render/:id/job { jobId, status: running|converting_voice|rendering|done|failed, error?, runUrl?, progress?, stage? }
// — progress from the render workflow. 400 only for a report that can't be used (missing job id, unknown status) or an
// unknown job; a server or database failure is a retryable 503 with the reason, so a worker's failure report retries
// instead of being lost.
export async function POST(request: Request, ctx: RouteContext<"/api/render/[id]/job">) {
  if (!renderAuthorized(request)) return notFound();
  const { id } = await ctx.params;
  const parsed = parseJobReport(await request.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const r = parsed.report;
  try {
    await updateRenderJob(id, r.jobId, r.status, r.error, r.runUrl, r.progress, r.stage);
  } catch (err) {
    if (err instanceof Error && /^(Unknown render job|Bad status)/.test(err.message)) return Response.json({ error: err.message }, { status: 400 });
    return serverError(`render job ${r.jobId}`, err, 503);
  }
  try {
    revalidatePath(`/create/${id}`);
  } catch (err) {
    console.error(`[render job ${r.jobId}] revalidate failed (the status was saved):`, err);
  }
  return Response.json({ ok: true });
}
