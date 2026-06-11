// Gray skeleton bars — Stage-3 wiring (git log feed, Vercel API) comes later.
const widths = ["w-3/4", "w-1/2", "w-5/6", "w-2/3", "w-1/3", "w-4/5"];

export default function Runs() {
  return (
    <div className="flex flex-col gap-3">
      {widths.map((w, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="size-2 rounded-full bg-zinc-700" />
          <div className={`h-3 rounded bg-zinc-800 ${w}`} />
        </div>
      ))}
      <p className="mt-2 text-xs text-zinc-600">
        git log feed + Vercel deploy health land here in Stage 3
      </p>
    </div>
  );
}
