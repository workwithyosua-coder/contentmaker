import { revalidatePath } from "next/cache";
import { notFound, renderAuthorized } from "@/lib/render";
import { updateRenderJob } from "@/lib/render-jobs";

// POST /api/render/:id/job { jobId, status: running|done|failed, error?, runUrl?, progress?, stage? } — progress from the render workflow.
export async function POST(request: Request, ctx: RouteContext<"/api/render/[id]/job">) {
  if (!renderAuthorized(request)) return notFound();
  const { id } = await ctx.params;
  const b = (await request.json().catch(() => ({}))) as { jobId?: string; status?: string; error?: string; runUrl?: string; progress?: number; stage?: string };
  if (!b.jobId || !/^[0-9a-f-]{36}$/.test(b.jobId) || !b.status) return Response.json({ error: "jobId and status are required." }, { status: 400 });
  try {
    await updateRenderJob(id, b.jobId, b.status, b.error?.slice(0, 500), b.runUrl, b.progress, b.stage?.slice(0, 80));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  revalidatePath(`/create/${id}`);
  return Response.json({ ok: true });
}
