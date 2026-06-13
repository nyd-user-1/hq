import BoundaryChip from "@/app/ui/boundary-chip";

// The demo's trick: every layout/page draws its own dashed box with its
// file path sitting on the border, so the route anatomy is visible on screen.
// The chip is click-to-copy. `lead` renders as its own separate chip just
// before the path chip (e.g. the sidebar toggle on the terminal boundary);
// `trail` renders just after it (e.g. the new-session "+").
export default function Boundary({
  label,
  lead,
  trail,
  topOnly = false,
  children,
}: {
  label: string;
  lead?: React.ReactNode;
  trail?: React.ReactNode;
  // `topOnly`: just a dashed TOP line (no box, no side/bottom border, no
  // horizontal padding) so the content reclaims the ~40px the box would inset.
  // Used by the inner panel pages, which already sit inside their group layout's
  // full box — the outer box keeps the content off the panel edge.
  topOnly?: boolean;
  children: React.ReactNode;
}) {
  const frame = topOnly
    ? "border-t border-dashed border-zinc-700 pt-7"
    : "rounded-lg border border-dashed border-zinc-700 p-4 pt-7 sm:p-5 sm:pt-7";
  return (
    <div
      className={`boundary-flash relative flex min-h-0 min-w-0 flex-1 flex-col gap-4 ${frame}`}
    >
      <span className="absolute -top-2.5 left-4 flex max-w-[calc(100%-2rem)] items-center gap-2">
        {lead}
        <BoundaryChip label={label} />
        {trail}
      </span>
      {children}
    </div>
  );
}
