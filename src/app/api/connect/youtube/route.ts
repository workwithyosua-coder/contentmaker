import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { youtubeAuthorizeUrl, youtubeConfigured } from "@/lib/platforms/youtube";

// Step 1: send the owner to Google's consent screen.
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  if (!youtubeConfigured()) return NextResponse.redirect(new URL("/accounts?error=youtube_not_configured", origin));
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(youtubeAuthorizeUrl(origin, state));
  res.cookies.set("youtube_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/connect/youtube",
    maxAge: 600,
  });
  return res;
}
