import Boundary from "@/app/ui/boundary";
import { getProjects } from "@/lib/vault";

export const dynamic = "force-dynamic";

// To Do = the HQ project's own 002 Roadmap, read live from the vault.
export default function ToDo() {
  const hq = getProjects().find((p) => p.slug === "hq");
  return (
    <Boundary label="@activity/todo/page.tsx">
      {hq && hq.roadmap.length > 0 ? (
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-zinc-300">
          {hq.roadmap.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-zinc-600">no roadmap items found</p>
      )}
      <p className="text-xs text-zinc-600">
        reads !hq/*launchpad/002 Roadmap.md live from the vault
      </p>
    </Boundary>
  );
}
