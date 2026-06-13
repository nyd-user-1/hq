import Boundary from "@/app/ui/boundary";
import { vaultPulse } from "@/lib/vault";
import { ago } from "@/lib/ago";

export const dynamic = "force-dynamic";

// Vault Pulse: the most recently touched files across the whole vault.
export default function VaultPulse() {
  const pulse = vaultPulse(12);
  return (
    <Boundary label="@panel/pulse/page.tsx">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">Vault Pulse</h3>
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          recent file activity
        </span>
      </div>
      {pulse.length > 0 ? (
        <ul className="scrollbar-none flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {pulse.map((p) => (
            <li
              key={`${p.project}/${p.rel}`}
              className="flex items-baseline gap-2 text-sm"
            >
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-blue-400/80">
                {p.project}
              </span>
              <span className="min-w-0 truncate text-zinc-300">{p.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-600">
                {ago(p.mtime)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-600">vault not found on this machine</p>
      )}
      <p className="text-xs text-zinc-600">
        ~/vaults/hq · markdown &amp; notes, newest first
      </p>
    </Boundary>
  );
}
