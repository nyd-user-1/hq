import Boundary from "@/app/ui/boundary";
import Terminal from "@/app/ui/terminal";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  return (
    <Boundary label="page.tsx">
      <Terminal />
    </Boundary>
  );
}
