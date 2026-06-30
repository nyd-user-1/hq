import { getEnvironment } from "@/lib/environment";

// Reads the live process env — never cache.
export const dynamic = "force-dynamic";

// GET — the safe, masked environment allowlist for the Environment panel.
export async function GET() {
  return Response.json({ items: getEnvironment() });
}
