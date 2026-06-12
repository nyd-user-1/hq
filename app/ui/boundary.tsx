import BoundaryChip from "@/app/ui/boundary-chip";

// The demo's trick: every layout/page draws its own dashed box with its
// file path sitting on the border, so the route anatomy is visible on screen.
// The chip is click-to-copy. `lead` renders as its own separate chip just
// before the path chip (e.g. the sidebar toggle on the terminal boundary).
export default function Boundary({
  label,
  lead,
  children,
}: {
  label: string;
  lead?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="boundary-flash relative flex min-h-0 min-w-0 flex-1 flex-col gap-4 rounded-lg border border-dashed border-zinc-700 p-4 pt-7 sm:p-5 sm:pt-7">
      <span className="absolute -top-2.5 left-4 flex max-w-[calc(100%-2rem)] items-center gap-2">
        {lead}
        <BoundaryChip label={label} />
      </span>
      {children}
    </div>
  );
}
