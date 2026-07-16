import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSettings } from "@/lib/settings";

// Next.js 16 renamed `middleware` to `proxy`. This gates the app behind the
// onboarding wizard until the user has finished setup.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip: onboarding itself, all API routes, Next.js internals, static assets
  if (
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/icon") ||
    /\.(svg|png|jpg|jpeg|gif|ico|webp)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  const settings = getSettings();
  if (!settings.setupComplete) {
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match everything except API routes, static files, and Next.js internals
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|icon.icns).*)",
  ],
};
