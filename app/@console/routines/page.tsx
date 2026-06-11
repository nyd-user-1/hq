import Boundary from "@/app/ui/boundary";

const routines = [
  { name: "morning portfolio sweep", cadence: "daily" },
  { name: "roadmap drift check", cadence: "weekly" },
  { name: "token burn rollup", cadence: "weekly" },
];

export default function Routines() {
  return (
    <Boundary label="@console/routines/page.tsx">
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {routines.map((r) => (
            <li
              key={r.name}
              className="flex items-center justify-between rounded-md border border-zinc-700 px-3 py-2"
            >
              <span className="text-sm text-zinc-300">{r.name}</span>
              <span className="text-xs text-zinc-500">{r.cadence}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-zinc-600">
          sketches only — later: scheduled cloud agents via /schedule
        </p>
      </div>
    </Boundary>
  );
}
