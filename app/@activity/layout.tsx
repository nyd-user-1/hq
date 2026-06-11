import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import TabNav from "@/app/ui/tab-nav";

export default function ActivityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@activity/layout.tsx">
      <TabNav
        tabs={[
          { title: "Usage", href: "/usage", segment: "usage" },
          { title: "Sessions", href: "/sessions", segment: "sessions" },
          { title: "Calls", href: "/", segment: null },
          { title: "To Do", href: "/todo", segment: "todo" },
        ]}
      />
      <FlashOnNav>{children}</FlashOnNav>
    </Boundary>
  );
}
