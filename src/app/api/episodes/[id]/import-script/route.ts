import { revalidatePath } from "next/cache";
import { getOwner } from "@/lib/queries";
import { importScript } from "@/lib/script-import";

export const maxDuration = 300;

// POST /api/episodes/:id/import-script { script, notes?, mode?: "exact" | "adapt" }
// Same as the episode page's Paste / Import tab. Protected by the app password (proxy), like every page.
export async function POST(request: Request, ctx: RouteContext<"/api/episodes/[id]/import-script">) {
  const { id } = await ctx.params;
  const owner = await getOwner();
  if (!owner) return Response.json({ error: "No user found." }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { script?: string; notes?: string; mode?: string };
  try {
    const r = await importScript({ ownerId: owner.id, projectId: id, mode: b.mode === "adapt" ? "adapt" : "exact", paste: b.script ?? "", notes: b.notes ?? "" });
    revalidatePath(`/create/${id}`);
    revalidatePath(`/create/${id}/record`);
    return Response.json({ ok: true, ...r });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
