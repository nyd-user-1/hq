import Boundary from "@/app/ui/boundary";
import ComponentsList from "@/app/ui/components-list";
import { orderedComponents, readComponentSource } from "@/lib/components";

export const dynamic = "force-dynamic";

// Components = the HQ component registry (lib/components.ts), rendered as
// accordion cards (AccordionItem — its first use outside To Do). The source of
// each component is read on the server and shown as the card body; the saved
// display order is applied here, reorder persists via /api/components.
export default function Components() {
  const items = orderedComponents().map((c) => ({
    ...c,
    code: readComponentSource(c.file),
  }));
  return (
    <Boundary topOnly label="@panel/(activity)/components/page.tsx">
      <ComponentsList items={items} />
    </Boundary>
  );
}
