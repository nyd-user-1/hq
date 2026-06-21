import { NextResponse, type NextRequest } from "next/server";

// HQ is a localhost-only tool that can spawn `claude`, read files off disk, and
// mutate state — with no auth, by design. That makes the "only this machine can
// reach it" assumption a SECURITY BOUNDARY that has to be enforced, not assumed.
// This proxy (Next 16's renamed `middleware` convention) closes the two
// browser-class holes the code review flagged (CODE-REVIEW SEC-1), so a web page
// you happen to have open — or a LAN peer — can't drive HQ:
//
//   • DNS-rebinding — a page whose hostname has been rebound to 127.0.0.1 still
//     carries a FOREIGN Host header. We accept only loopback Hosts.
//   • CSRF — a cross-site page POSTing to localhost. Browsers attach an `Origin`
//     to every cross-origin request (and to all non-GET requests), and
//     `Sec-Fetch-Site` on modern browsers; we reject anything that declares a
//     non-local origin/site. Same-origin app traffic (the HQ UI itself) and
//     non-browser local clients (the OTEL exporter, hooks — no Origin) pass.

function stripPort(host: string): string {
  return host.replace(/:\d+$/, "").toLowerCase();
}

function hostIsLocal(host: string | null): boolean {
  if (!host) return false;
  const h = stripPort(host);
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

function originIsLocal(origin: string | null): boolean {
  if (!origin) return false;
  try {
    return hostIsLocal(new URL(origin).host);
  } catch {
    return false;
  }
}

function forbid(why: string): NextResponse {
  return new NextResponse(`HQ blocked a non-local request (${why}).`, { status: 403 });
}

export function proxy(req: NextRequest): NextResponse {
  // DNS-rebinding defense: the Host must be a loopback name on every request.
  if (!hostIsLocal(req.headers.get("host"))) return forbid("host");

  // CSRF defense: a declared origin/site must be local. Absent headers (top-level
  // navigations, non-browser clients) are allowed — browsers can't suppress
  // Origin on a cross-origin request, so "absent" is never a cross-site attack.
  const origin = req.headers.get("origin");
  if (origin && !originIsLocal(origin)) return forbid("origin");

  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return forbid("site");

  return NextResponse.next();
}

export const config = {
  // Every route except Next's static asset pipeline. The Host check then covers
  // page routes too (e.g. a rebind GET to /audit), not just /api.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
