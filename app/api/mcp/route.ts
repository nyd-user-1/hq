import { getMcpServers } from "@/lib/mcp";

// Reads ~/.claude.json + this repo's .mcp.json off disk; never cache.
export const dynamic = "force-dynamic";

// GET — every locally-configured MCP server (global + per-project from
// ~/.claude.json, plus this repo's checked-in .mcp.json), tagged with scope.
// ?cwd= overrides the repo whose .mcp.json is read (defaults to the server's).
export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd") || process.cwd();
  return Response.json({ servers: getMcpServers(cwd) });
}
