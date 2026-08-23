import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomicSync } from "@/lib/atomic";

// RETENTION — the one deliberate write HQ offers into ~/.claude/settings.json,
// and it's consent-gated by design: the retention banner (retention-banner.tsx)
// asks, the user clicks, THEN this route pins `cleanupPeriodDays` to 3650 so
// Claude Code stops silently deleting transcripts at its 30-day default.
// Sweep-or-keep (lib/sweep.ts) becomes the user's own, visible lifecycle.
//
// Defensive by contract: an unparseable settings.json is NEVER clobbered — we
// refuse with a 409 rather than risk a user's config. Atomic write, respects
// CLAUDE_CONFIG_DIR, and the GET never returns more than the one number.

export const dynamic = "force-dynamic";

const PIN_DAYS = 3650;
const settingsPath = () =>
  path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "settings.json");

function readDays(): { days: number | null; parseError: boolean } {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    const j = JSON.parse(raw);
    const d = j?.cleanupPeriodDays;
    return { days: typeof d === "number" ? d : null, parseError: false };
  } catch (e) {
    return { days: null, parseError: fs.existsSync(settingsPath()) };
  }
}

export async function GET() {
  const { days, parseError } = readDays();
  return Response.json({ days, pinned: (days ?? 0) >= PIN_DAYS, parseError });
}

export async function POST() {
  const p = settingsPath();
  let j: Record<string, unknown> = {};
  if (fs.existsSync(p)) {
    try {
      j = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return Response.json(
        { error: "settings.json is unparseable — refusing to modify it" },
        { status: 409 },
      );
    }
  }
  j.cleanupPeriodDays = PIN_DAYS;
  writeFileAtomicSync(p, JSON.stringify(j, null, 2) + "\n");
  return Response.json({ days: PIN_DAYS, pinned: true });
}
