import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, isAuthed } from "@/lib/auth";

// Everything except the login page and public app assets requires the owner password.
export async function proxy(request: NextRequest) {
  if (await isAuthed(request.cookies.get(AUTH_COOKIE)?.value)) return NextResponse.next();
  const url = new URL("/login", request.url);
  if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!login|api/health|_next/static|_next/image|manifest.webmanifest|icon-192.png|icon-512.png|icon-maskable-512.png|apple-touch-icon.png|favicon.ico).*)",
  ],
};
