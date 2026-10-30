import { NextResponse, type NextRequest } from "next/server";

// The API runs Claude and a shell on this Mac, so only Vlens's own pages may use it.
// - Host must be this Mac: blocks DNS rebinding (a site pointing its name at 127.0.0.1).
// - Anything but GET must come from the same origin: blocks another site's page
//   in your browser from POSTing here (a plain-text POST needs no CORS preflight).
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!LOCAL.test(host)) return NextResponse.json({ error: "Vlens only answers on this Mac" }, { status: 403 });

  if (req.method !== "GET" && req.method !== "HEAD") {
    const site = req.headers.get("sec-fetch-site");
    const origin = req.headers.get("origin");
    const sameOrigin = site ? site === "same-origin" || site === "none" : !origin || new URL(origin).host === host;
    if (!sameOrigin) return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
