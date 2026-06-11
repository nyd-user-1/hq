import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import TabNav from "@/app/ui/tab-nav";

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@console/layout.tsx">
      <TabNav
        tabs={[
          { title: "Home", href: "/", segment: null },
          { title: "Skills", href: "/skills", segment: "skills" },
          { title: "Routines", href: "/routines", segment: "routines" },
        ]}
      />
      <FlashOnNav>{children}</FlashOnNav>
    </Boundary>
  );
}
