import Boundary from "@/app/ui/boundary";
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
          { title: "Home", href: "/", segment: null },
          { title: "Runs", href: "/runs", segment: "runs" },
        ]}
      />
      {children}
    </Boundary>
  );
}
