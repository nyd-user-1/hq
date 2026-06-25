import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The Claude Code plugin CATALOG — read straight off disk, no network. When a
// marketplace is registered, CC caches its manifest to
// ~/.claude/plugins/marketplaces/<name>/.claude-plugin/marketplace.json. We parse
// every registered marketplace's manifest for the available plugins, and read
// ~/.claude/settings.json `enabledPlugins` for which are on. This is what turns
// the Plugins panel from a curated 5 into a manager for the whole ecosystem
// (238+ in the official marketplace alone).

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const MARKETPLACES = path.join(CLAUDE_DIR, "plugins", "marketplaces");

type Manifest = {
  name?: string;
  plugins?: Array<{ name?: string; description?: string; category?: string }>;
};

export type CatalogPlugin = {
  ref: string; // <plugin>@<marketplace> — the id `claude plugin install/enable` uses
  name: string;
  marketplace: string;
  description: string;
  category?: string;
  enabled: boolean; // installed + active (settings.json enabledPlugins[ref] === true)
};

function enabledMap(): Record<string, boolean> {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, "settings.json"), "utf8"));
    return (s?.enabledPlugins as Record<string, boolean>) ?? {};
  } catch {
    return {};
  }
}

export function isEnabled(ref: string): boolean {
  return enabledMap()[ref] === true;
}

export function getCatalog(): CatalogPlugin[] {
  const enabled = enabledMap();
  const out: CatalogPlugin[] = [];
  let dirs: string[];
  try {
    dirs = fs
      .readdirSync(MARKETPLACES, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  for (const dir of dirs) {
    let mf: string | undefined;
    for (const c of [".claude-plugin/marketplace.json", "marketplace.json"]) {
      const p = path.join(MARKETPLACES, dir, c);
      if (fs.existsSync(p)) {
        mf = p;
        break;
      }
    }
    if (!mf) continue;
    let j: Manifest;
    try {
      j = JSON.parse(fs.readFileSync(mf, "utf8")) as Manifest;
    } catch {
      continue;
    }
    const market = typeof j.name === "string" ? j.name : dir;
    for (const p of j.plugins ?? []) {
      if (!p?.name) continue;
      const ref = `${p.name}@${market}`;
      out.push({
        ref,
        name: p.name,
        marketplace: market,
        description: typeof p.description === "string" ? p.description : "",
        category: typeof p.category === "string" ? p.category : undefined,
        enabled: enabled[ref] === true,
      });
    }
  }
  // enabled first, then alphabetical
  out.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  return out;
}
