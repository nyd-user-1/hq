import TabNav from "@/app/ui/tab-nav";

export default function ActivityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <TabNav
        tabs={[
          { title: "Home", href: "/", segment: null },
          { title: "Runs", href: "/runs", segment: "runs" },
          { title: "Usage", href: "/usage", segment: "usage" },
        ]}
      />
      {children}
    </div>
  );
}
