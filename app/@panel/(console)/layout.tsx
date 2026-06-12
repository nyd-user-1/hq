import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import TabNav from "@/app/ui/tab-nav";

export const dynamic = "force-dynamic";

// Console panel: Vault Pulse · Skills · Routines.
export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@panel/(console)/layout.tsx">
      <TabNav
        tabs={[
          { title: "Vault Pulse", href: "/pulse", segment: "pulse" },
          { title: "Skills", href: "/skills", segment: "skills" },
          { title: "Routines", href: "/routines", segment: "routines" },
        ]}
      />
      <FlashOnNav>{children}</FlashOnNav>
    </Boundary>
  );
}
