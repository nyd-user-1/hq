const skills = ["code-review", "verify", "simplify", "run", "deep-research"];

export default function Skills() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {skills.map((s) => (
          <button
            key={s}
            disabled
            className="cursor-not-allowed rounded-md border border-zinc-700 px-3 py-1.5 font-mono text-sm text-zinc-400"
          >
            /{s}
          </button>
        ))}
      </div>
      <p className="text-xs text-zinc-600">dead in v0 — later: run via claude -p</p>
    </div>
  );
}
