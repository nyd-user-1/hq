import {
  saveComponentsOrder,
  orderedComponents,
  readComponentSource,
  componentId,
  undiscoveredComponents,
  REGISTRY_SESSION,
  REGISTRY_CREATED_AT,
} from "@/lib/components";

export const dynamic = "force-dynamic";

// GET — the component registry as the @panel/components page builds it (ordered +
// each file's source + c_ id + provenance) plus the undiscovered list. Feeds the
// standalone components-panel (client) the same data the server page passes inline.
export function GET() {
  const items = orderedComponents().map((c) => ({
    ...c,
    code: readComponentSource(c.file),
    id: componentId(c.name),
    session: REGISTRY_SESSION,
    createdAt: REGISTRY_CREATED_AT,
  }));
  return Response.json({ items, undiscovered: undiscoveredComponents() });
}

// PUT { order: string[] } — persist the Components registry display order
// (drag-to-reorder) to the HQ-native sidecar.
export async function PUT(req: Request) {
  try {
    const { order } = await req.json();
    if (!Array.isArray(order)) {
      return Response.json({ error: "order must be an array" }, { status: 400 });
    }
    saveComponentsOrder(order.filter((x): x is string => typeof x === "string"));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
}
