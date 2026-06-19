import { NextRequest, NextResponse } from "next/server";
import { getRecentSessions } from "@/lib/sessions";

export const dynamic = "force-dynamic";

// /go — the stable external open-contract. Spotlight, the hq:// scheme, and any
// future automation hit /go?type=<t>&ref=<r>; this is the ONLY entry point they
// know. It maps the type to the current internal Search param and redirects, so
// the in-app URLs (?openNote=, ?open=, ?openTodo=, ?openSession=, ?openCommit=)
// can change freely without breaking external links.
//
// It also resolves a session pin: deep-links carry no terminal context, and a
// panel URL without ?session makes the terminal self-re-pin and wipe the panel
// params (the "snaps back" bug). Pinning the newest session here avoids that.
const PARAM: Record<string, string> = {
  note: "openNote",
  memory: "open",
  todo: "openTodo",
  transcript: "openSession",
  session: "openSession",
  commit: "openCommit",
};

export function GET(req: NextRequest) {
  const u = new URL(req.url);
  const type = u.searchParams.get("type") ?? "";
  const ref = u.searchParams.get("ref") ?? "";
  const dest = new URL("/search", u.origin);
  const param = PARAM[type];
  if (param && ref) dest.searchParams.set(param, ref);
  const sid = u.searchParams.get("session") || getRecentSessions(1)[0]?.id;
  if (sid) dest.searchParams.set("session", sid);
  return NextResponse.redirect(dest, 307);
}
