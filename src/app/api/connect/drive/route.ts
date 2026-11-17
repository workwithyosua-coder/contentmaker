import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { DRIVE_SCOPES } from "@/lib/drive";
import { youtubeAuthorizeUrl, youtubeConfigured } from "@/lib/platforms/youtube";

// Step 1: send the owner to Google's consent screen for Drive (files this app creates only).
// Google sends them back to the already-registered /api/connect/youtube/callback; `state` starts with "drive." there.
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  if (!youtubeConfigured()) return NextResponse.redirect(new URL("/accounts?error=youtube_not_configured", origin));
  const state = `drive.${randomBytes(16).toString("hex")}`;
  const res = NextResponse.redirect(youtubeAuthorizeUrl(origin, state, DRIVE_SCOPES));
  res.cookies.set("youtube_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/connect/youtube", maxAge: 600 });
  return res;
}
