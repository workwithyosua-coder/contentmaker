import { NextResponse } from "next/server";
import { getOwner } from "@/lib/queries";
import { listQueue } from "@/lib/scheduler-server";

// GET /api/schedule/queue: the signed-in owner's slots with their status and pipeline progress, for the Schedule
// page's live progress bars (polled every 4 s while a slot is running). Behind the login like every page.
export async function GET() {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const rows = await listQueue(owner.id);
  return NextResponse.json(
    {
      slots: rows.map((q) => ({
        id: q.id,
        status: q.status,
        error: q.error_message,
        runUrl: q.run_url,
        episodeTitle: q.episode_title ?? null,
        progressPercent: q.progress_percent,
        progressStage: q.progress_stage,
        progressDetail: q.progress_detail,
        progressUpdatedAt: q.progress_updated_at ? q.progress_updated_at.toISOString() : null,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
