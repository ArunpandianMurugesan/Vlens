import { NextResponse, type NextRequest } from "next/server";

// The API runs Claude and a shell on this Mac, so only Vlens's own pages may use it.
// - Host must be this Mac: blocks DNS rebinding (a site pointing its name at 127.0.0.1).
// - No request from another site, whatever the method: a page in your browser can
//   send GETs freely (<img src>, links), and some GETs here start processes or
//   serve files, so GET is not "safe" enough to let through.
// - Anything but GET must also come from the same origin when the browser doesn't
//   send Sec-Fetch-Site (a plain-text POST needs no CORS preflight).
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!LOCAL.test(host)) return NextResponse.json({ error: "Vlens only answers on this Mac" }, { status: 403 });

  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });

  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    const sameOrigin = site ? site === "same-origin" || site === "none" : !origin || new URL(origin).host === host;
    if (!sameOrigin) return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
