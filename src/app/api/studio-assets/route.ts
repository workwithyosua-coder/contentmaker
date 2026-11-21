import { NextResponse } from "next/server";
import { getOwner } from "@/lib/queries";
import { listStudioAssets } from "@/lib/studio-assets";
import { STUDIO_SLOTS } from "@/lib/studioAssets";

// GET /api/studio-assets: every global studio slot with its public URL (cache-busted) or null when missing.
export async function GET(request: Request) {
  if (!(await getOwner())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const status = await listStudioAssets(new URL(request.url).origin);
  return NextResponse.json({ slots: STUDIO_SLOTS.map((s) => ({ ...s, ...status.find((x) => x.key === s.key) })) }, { headers: { "Cache-Control": "no-store" } });
}
