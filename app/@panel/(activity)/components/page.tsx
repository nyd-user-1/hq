import Boundary from "@/app/ui/boundary";
import ComponentsList from "@/app/ui/components-list";
import {
  orderedComponents,
  readComponentSource,
  componentId,
  undiscoveredComponents,
  REGISTRY_SESSION,
  REGISTRY_CREATED_AT,
} from "@/lib/components";

export const dynamic = "force-dynamic";

// Components = the HQ component registry (lib/components.ts), rendered as
// accordion cards (AccordionItem — its first use outside To Do). The source of
// each component is read on the server and shown as the card body; each entry
// gets its c_ id + registry provenance; the saved display order is applied here,
// reorder persists via /api/components.
export default function Components() {
  const items = orderedComponents().map((c) => ({
    ...c,
    code: readComponentSource(c.file),
    id: componentId(c.name),
    session: REGISTRY_SESSION,
    createdAt: REGISTRY_CREATED_AT,
  }));
  return (
    <Boundary topOnly bleedX label="@panel/(activity)/components/page.tsx">
      <ComponentsList items={items} undiscovered={undiscoveredComponents()} />
    </Boundary>
  );
}
