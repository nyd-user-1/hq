import { NextResponse } from "next/server";
import { recordOtelLogs } from "@/lib/otel";

export const dynamic = "force-dynamic";

// HQ's OTLP/HTTP-JSON LOGS receiver. With telemetry enabled (opt-in env, see the
// /cmd snippet), Claude Code POSTs its `claude_code.api_request` cost/usage events
// here. We parse + append the cost records (lib/otel.ts) and return the OTLP
// success envelope. No collector, no new dep — just JSON-over-HTTP in a route.
//
// The exporter is fire-and-forget into a possibly-half-up server, so we never
// throw and always answer 200 (a non-2xx makes the exporter retry/queue).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (body && typeof body === "object") {
    try {
      recordOtelLogs(body);
    } catch {
      // best-effort sink — never fail the export
    }
  }
  // ExportLogsServiceResponse — empty object = full success.
  return NextResponse.json({});
}
