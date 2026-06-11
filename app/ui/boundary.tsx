// The demo's trick: every layout/page draws its own dashed box with its
// file path sitting on the border, so the route anatomy is visible on screen.
export default function Boundary({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-4 rounded-lg border border-dashed border-zinc-700 p-5 pt-7">
      <span className="absolute -top-2.5 left-4 bg-zinc-800 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-400">
        {label}
      </span>
      {children}
    </div>
  );
}
