import { saveComponentsOrder } from "@/lib/components";

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
