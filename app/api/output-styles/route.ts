import { getStylesLibrary } from "@/lib/output-styles";

// Reads ~/.claude/output-styles + enabled plugins' styles off disk; never cache.
export const dynamic = "force-dynamic";

// GET — the unified output-styles library (yours + plugin-shipped + built-ins),
// each tagged with its source. The client searches/filters it.
export async function GET() {
  return Response.json({ styles: getStylesLibrary() });
}
