import Boundary from "@/app/ui/boundary";
import { COMPONENTS, type ComponentEntry } from "@/lib/components";

export const dynamic = "force-dynamic";

// Row aesthetic borrowed from the Skills panel: provenance dot · name · desc
// (truncates) · right-aligned tag.
const ROW =
  "flex w-full items-baseline gap-3 border-b border-zinc-800/60 py-3 text-left";

// Components = the HQ component registry (lib/components.ts). Approved (blue) are
// design-system components — reviewed, named per the taxonomy, reusable. Review
// (red) exist in app/ui but aren't audited in yet.
export default function Components() {
  const approved = COMPONENTS.filter((c) => c.status === "approved");
  const review = COMPONENTS.filter((c) => c.status === "review");

  const section = (
    title: string,
    tone: "blue" | "red",
    items: ComponentEntry[]
  ) => (
    <section className="flex flex-col gap-1">
      <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
        {title}
      </h2>
      <div className="flex flex-col">
        {items.map((c) => (
          <div key={c.name} className={ROW}>
            <span className="flex shrink-0 items-baseline gap-1.5">
              <span
                className={`text-[10px] leading-none ${
                  tone === "blue" ? "text-blue-500" : "text-red-500"
                }`}
                aria-hidden
              >
                ●
              </span>
              <span className="font-mono text-xs text-zinc-200">{c.name}</span>
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
              {c.desc}
            </span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-zinc-600">
              {c.kind}
            </span>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <Boundary topOnly label="@panel/(activity)/components/page.tsx">
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        <p className="text-xs text-zinc-600">
          HQ component registry —{" "}
          <span className="text-blue-400/80">Approved</span> are design-system
          components (reviewed, named, reusable);{" "}
          <span className="text-red-400/80">Review</span> exist in app/ui but
          aren&apos;t audited in yet.
        </p>
        {section("Approved", "blue", approved)}
        {section("Review", "red", review)}
      </div>
    </Boundary>
  );
}
