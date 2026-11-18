import { revalidatePath } from "next/cache";
import { publicationsFor } from "@/lib/publish/engine";
import { handlePublish, type PublishRequest } from "@/lib/publish/requests";
import { getOwner } from "@/lib/queries";

export const maxDuration = 300;

// POST /api/episodes/:id/publish { mode: now | schedule | retry | cancel, at?: ISO time, settings?: per-platform settings }
// GET  /api/episodes/:id/publish → per-platform status. Behind the app password (proxy), like every page.
export async function POST(request: Request, ctx: RouteContext<"/api/episodes/[id]/publish">) {
  const { id } = await ctx.params;
  const owner = await getOwner();
  if (!owner) return Response.json({ error: "No user found." }, { status: 401 });
  try {
    const r = await handlePublish(owner.id, id, (await request.json()) as PublishRequest);
    revalidatePath(`/create/${id}`);
    return Response.json({ ok: true, ...r });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function GET(_request: Request, ctx: RouteContext<"/api/episodes/[id]/publish">) {
  const { id } = await ctx.params;
  return Response.json(await publicationsFor(id));
}
