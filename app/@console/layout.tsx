import TabNav from "@/app/ui/tab-nav";

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <TabNav
        tabs={[
          { title: "Home", href: "/", segment: null },
          { title: "Skills", href: "/skills", segment: "skills" },
          { title: "Routines", href: "/routines", segment: "routines" },
        ]}
      />
      {children}
    </div>
  );
}
