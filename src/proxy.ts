import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, isAuthed } from "@/lib/auth";

// Everything except the login page and public app assets requires the owner password.
// api/media is the local storage driver's file route (dev/tests only, 404 in production): every request carries its
// own expiring HMAC signature, so the renderer can fetch signed custom assets without a login cookie, like Supabase.
export async function proxy(request: NextRequest) {
  if (await isAuthed(request.cookies.get(AUTH_COOKIE)?.value)) return NextResponse.next();
  const url = new URL("/login", request.url);
  if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!login|privacy|terms|data-deletion|api/health|api/cron|api/render|api/scheduler|api/media|props/|cast/|tiktok[^/]*\\.txt|_next/static|_next/image|manifest.webmanifest|icon-192.png|icon-512.png|icon-maskable-512.png|icon-1024.png|apple-touch-icon.png|favicon.ico).*)",
  ],
};
