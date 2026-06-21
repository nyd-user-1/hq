import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

// Atomic file write — write a temp file in the SAME directory, then rename it
// over the destination. rename(2) is atomic on a POSIX filesystem, so a reader
// only ever sees the complete OLD file or the complete NEW file — never a
// half-written one.
//
// This closes the failure mode every HQ sidecar shared (CODE-REVIEW BUG-1): a
// process dying mid-`writeFileSync` (Ctrl-C, OOM, an ill-timed dev reload) left a
// TRUNCATED file on disk → the next `read()` hit a JSON parse error → its catch
// returned an EMPTY store → the next write persisted that empty store → every
// to-do/setting silently gone. It is also the only correct fix for two HQ server
// processes (dev + the packaged app) sharing ~/.claude/hq: the torn READ can't
// happen because the destination is never partially written. (Cross-process lost
// *updates* — two whole writes racing — still need a lock; that's a separate,
// far milder, far rarer concern and intentionally out of scope here.)
//
// The temp lives in the destination dir (not /tmp) so the rename stays on one
// filesystem; a failed write unlinks its temp and rethrows.
export function writeFileAtomicSync(file: string, data: string | Buffer): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`
  );
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* nothing to clean up */
    }
    throw err;
  }
}
