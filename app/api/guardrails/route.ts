import { getGuardrails, GUARDRAILS_CONFIG_PATH } from "@/lib/guardrails";

// Reads the priced calls + caps off disk (lib/guardrails.ts) — never cache.
export const dynamic = "force-dynamic";

// GET — the cost-guardrails snapshot (weekly cap, burn, 2× bleed, top sessions,
// OTel overlay) plus the config path, the same data the @panel/(metrics)/
// guardrails route page renders server-side.
export async function GET() {
  return Response.json({
    guardrails: getGuardrails(),
    configPath: GUARDRAILS_CONFIG_PATH,
  });
}
