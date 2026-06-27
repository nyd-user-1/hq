import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// MCP — the Model Context Protocol servers configured for Claude Code, read off
// disk. Local servers live in two places: ~/.claude.json (a global `mcpServers`
// block plus a per-project `projects[path].mcpServers` block), and a project's
// checked-in `.mcp.json` (`{ mcpServers: {...} }`). We surface all of them,
// tagged with scope. (Remote claude.ai connectors are managed server-side and
// don't appear on disk, so they're out of scope for this disk reader.)
//
// We expose env VAR NAMES but never their values — config can hold secrets.

const HOME = os.homedir();

export type McpServer = {
  id: string;
  name: string;
  transport: string; // stdio · http · sse
  command: string; // stdio: the launch command (+ args); http/sse: the URL
  envKeys: string[]; // names only — values are never read
  scope: string; // grouping key: "global" · ".mcp.json" · a project path
  scopeLabel: string; // human label for the scope chip
};

type RawServer = {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
};

function normalize(name: string, raw: RawServer, scope: string, scopeLabel: string, idPrefix: string): McpServer {
  const transport = raw.type || (raw.url ? "http" : "stdio");
  const command = raw.url
    ? raw.url
    : [raw.command, ...(raw.args ?? [])].filter(Boolean).join(" ");
  return {
    id: `${idPrefix}:${name}`,
    name,
    transport,
    command,
    envKeys: raw.env ? Object.keys(raw.env) : [],
    scope,
    scopeLabel,
  };
}

function collect(servers: Record<string, RawServer> | undefined, scope: string, scopeLabel: string, idPrefix: string): McpServer[] {
  if (!servers || typeof servers !== "object") return [];
  return Object.entries(servers).map(([name, raw]) => normalize(name, raw, scope, scopeLabel, idPrefix));
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// All configured MCP servers. `cwd` (the active repo) is optional — when given we
// also read that repo's checked-in .mcp.json.
export function getMcpServers(cwd?: string): McpServer[] {
  const out: McpServer[] = [];

  const cfg = readJson(path.join(HOME, ".claude.json"));
  if (cfg) {
    out.push(...collect(cfg.mcpServers as Record<string, RawServer>, "global", "Global", "global"));
    const projects = (cfg.projects as Record<string, { mcpServers?: Record<string, RawServer> }>) || {};
    for (const [proj, val] of Object.entries(projects)) {
      const label = proj.split("/").filter(Boolean).pop() || proj;
      out.push(...collect(val?.mcpServers, `project:${proj}`, label, `proj:${proj}`));
    }
  }

  if (cwd) {
    const mcpJson = readJson(path.join(cwd, ".mcp.json"));
    if (mcpJson) {
      out.push(...collect(mcpJson.mcpServers as Record<string, RawServer>, ".mcp.json", ".mcp.json", "mcpjson"));
    }
  }

  return out;
}
