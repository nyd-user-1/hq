// Sort-direction glyph (no icon lib in HQ): bars + an arrow — down for
// newest-first (default), up for oldest-first. Shared by /search and Projects.
export default function SortIcon({ dir }: { dir: "new" | "old" }) {
  const arrow =
    dir === "new" ? (
      <>
        <path d="M6 5v13" />
        <path d="m3 15 3 3 3-3" />
      </>
    ) : (
      <>
        <path d="M6 19V6" />
        <path d="m3 9 3-3 3 3" />
      </>
    );
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 6h9" />
      <path d="M12 11h6" />
      <path d="M12 16h3" />
      {arrow}
    </svg>
  );
}
