import Boundary from "@/app/ui/boundary";
import BucketBoard from "@/app/ui/bucket-board";
import { getBuckets } from "@/lib/buckets";

export const dynamic = "force-dynamic";

// The Bucket Board: the bucketing workflow made visible. Reads the vault's
// 003 Buckets.md live; each bucket is one cohesive single-pass scored by shared
// working set (cohesion), not count. "Send all" fires a ripe bucket into the
// newest session.
export default function Buckets() {
  const buckets = getBuckets();
  return (
    <Boundary label="@panel/buckets/page.tsx">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Buckets</h2>
        <p className="text-sm text-zinc-500">
          One bucket = one cohesive single-pass, scored by{" "}
          <span className="text-zinc-300">cohesion</span> (shared working set),
          not count. <span className="text-green-400">green</span> keep adding ·{" "}
          <span className="text-amber-400">amber</span> ripe ·{" "}
          <span className="text-red-400">red</span> split.
        </p>
      </div>

      <BucketBoard buckets={buckets} />

      <p className="font-mono text-xs text-zinc-600">
        reads !hq/*launchpad/003 Buckets.md live
      </p>
    </Boundary>
  );
}
