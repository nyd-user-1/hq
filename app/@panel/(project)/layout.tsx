import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";

export const dynamic = "force-dynamic";

// Projects — its own panel group, opened from the panels menu (before Activity).
// No sub-tabs: the page renders its own header (title · sort · new) + search,
// claude.ai-style, so there's no TabNav row here.
export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@panel/(project)/layout.tsx">
      <FlashOnNav>{children}</FlashOnNav>
    </Boundary>
  );
}
