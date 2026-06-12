import Boundary from "@/app/ui/boundary";
import BucketBoard from "@/app/ui/bucket-board";
import { getBuckets } from "@/lib/buckets";

export const dynamic = "force-dynamic";

// The Bucket Board: the bucketing workflow made visible so it stops evaporating
// in chat. Each bucket is one cohesive single-pass; fullness is scored by shared
// working set (cohesion), not count. Data is the vault's 003 Buckets.md, read
// live — edit there to fill, split, or empty a bucket; "Send all" fires a ripe
// bucket into the newest session as one batch.
export default function Buckets() {
  const buckets = getBuckets();
  return (
    <Boundary label="buckets/page.tsx">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">Buckets</h2>
        <p className="max-w-2xl text-sm text-zinc-500">
          One bucket = one cohesive single-pass. The meter scores fullness by{" "}
          <span className="text-zinc-300">cohesion</span> — how much the queued
          tasks share a working set — not by count.{" "}
          <span className="text-green-400">green</span> keep adding ·{" "}
          <span className="text-amber-400">amber</span> ripe, send now ·{" "}
          <span className="text-red-400">red</span> split.
        </p>
      </div>

      <BucketBoard buckets={buckets} />

      <p className="font-mono text-xs text-zinc-600">
        reads !hq/*launchpad/003 Buckets.md live — edit there to fill · split ·
        empty a bucket
      </p>
    </Boundary>
  );
}
