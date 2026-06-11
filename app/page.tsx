import { getProjects, vaultRoot } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default function Portfolio() {
  const projects = getProjects();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500">
        One row per project folder in <code className="font-mono">{vaultRoot()}</code>
      </p>
      <ul className="flex flex-col gap-4">
        {projects.map((p) => (
          <li
            key={p.folder}
            className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-base font-semibold">{p.slug}</span>
              <span className="font-mono text-xs text-zinc-500">
                vault: {p.folder}/
              </span>
              <span className="font-mono text-xs text-zinc-500">
                {p.repoPath ? `repo: ${p.repoPath}` : "no repo"}
              </span>
              <span className="ml-auto text-xs text-zinc-500">
                {p.threadCount} thread{p.threadCount === 1 ? "" : "s"}
              </span>
            </div>
            {p.roadmap.length > 0 ? (
              <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-zinc-300">
                {p.roadmap.slice(0, 3).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-zinc-600">no 002 Roadmap yet</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
