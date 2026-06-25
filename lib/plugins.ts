import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomicSync } from "@/lib/atomic";

// HQ's curated library of Claude Code agent plugins — behavior modes you toggle
// on/off here instead of cloning GitHub repos. ponytail (write less code) and
// caveman (terse output) are the seed entries; adding a plugin = one more PLUGINS
// row with its verified file contract, nothing else.
//
// HOW THE TOGGLE WORKS — and its honest limits.
// Both plugins read a persistent `defaultMode` config JSON at session START (their
// hooks load at init), so we set the default by WRITING THAT CONFIG. We never
// touch the per-session runtime flag (~/.claude/.<id>-active) — the plugin's own
// hook recomputes that from this config every session and would clobber us. Two
// consequences, both surfaced in the panel:
//   1. A change here lands on your NEXT session, not one already running.
//   2. An env override (PONYTAIL_/CAVEMAN_DEFAULT_MODE) BEATS the file — if it's
//      set, our write is shadowed (we report it so the UI can warn).
// Contracts verified from source: DietrichGebert/ponytail, JuliusBrussee/caveman.

export type PluginId = "ponytail" | "caveman";

export type PluginMode = { id: string; label: string; desc: string };

export type PluginDef = {
  id: PluginId;
  name: string;
  repo: string; // owner/name on GitHub
  blurb: string;
  // on/off + level vocabulary in display order; "off" is always first and means
  // `{ "defaultMode": "off" }` (the plugin then emits no rules).
  modes: PluginMode[];
  configDir: string; // ~/.config/<configDir>/config.json (XDG_CONFIG_HOME first)
  envVar: string; // the override that beats the file — surfaced as a warning
  install: string; // the install command we show + copy
  // node:fs sentinels: any existing → installed. settingsMarker = a substring we
  // look for in ~/.claude/settings.json (hook registration); pluginDirMatch = a
  // dir name fragment under ~/.claude/plugins; hookFile = a standalone-install
  // file under ~/.claude/hooks.
  detect: { hookFile?: string; pluginDirMatch: string; settingsMarker: string };
  caveat?: string; // an extra footnote (caveman's repo-local override)
};

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const XDG = process.env.XDG_CONFIG_HOME || path.join(HOME, ".config");

// The plugin's own default when neither env nor file is set (both ship `'full'`).
const PLUGIN_DEFAULT = "full";

export const PLUGINS: PluginDef[] = [
  {
    id: "ponytail",
    name: "Ponytail",
    repo: "DietrichGebert/ponytail",
    blurb: "Writes less code — runs a YAGNI decision ladder before the agent generates anything.",
    modes: [
      { id: "off", label: "Off", desc: "no influence" },
      { id: "lite", label: "Lite", desc: "a gentle nudge" },
      { id: "full", label: "Full", desc: "the standard ladder" },
      { id: "ultra", label: "Ultra", desc: "ruthless minimalism" },
    ],
    configDir: "ponytail",
    envVar: "PONYTAIL_DEFAULT_MODE",
    install:
      "/plugin marketplace add DietrichGebert/ponytail && /plugin install ponytail@ponytail",
    detect: {
      pluginDirMatch: "ponytail",
      settingsMarker: "ponytail-activate",
    },
  },
  {
    id: "caveman",
    name: "Caveman",
    repo: "JuliusBrussee/caveman",
    blurb: "Compresses the agent's output ~65% — terse, telegraphic, still correct.",
    modes: [
      { id: "off", label: "Off", desc: "normal prose" },
      { id: "lite", label: "Lite", desc: "drops filler" },
      { id: "full", label: "Full", desc: "telegraphic" },
      { id: "ultra", label: "Ultra", desc: "maximal compression" },
      { id: "wenyan", label: "Wényán", desc: "classical Chinese" },
    ],
    configDir: "caveman",
    envVar: "CAVEMAN_DEFAULT_MODE",
    install:
      "claude plugin marketplace add JuliusBrussee/caveman && claude plugin install caveman@caveman",
    detect: {
      hookFile: "caveman-activate.js",
      pluginDirMatch: "caveman",
      settingsMarker: "caveman-activate",
    },
    caveat:
      "A repo-local .caveman/config.json overrides this global default inside that repo.",
  },
];

// The config file we write to set the default (XDG_CONFIG_HOME first, like both
// plugins resolve it).
function configPath(def: PluginDef): string {
  return path.join(XDG, def.configDir, "config.json");
}

function fileMode(def: PluginDef): string | null {
  try {
    const raw = fs.readFileSync(configPath(def), "utf8");
    const v = JSON.parse(raw)?.defaultMode;
    return typeof v === "string" ? v.toLowerCase() : null;
  } catch {
    return null; // no file yet, or unreadable — treat as unset
  }
}

// Is the plugin actually on disk? Any sentinel hit counts. No single universal
// marker exists across plugin-install vs standalone-hooks installs, so we OR them.
function isInstalled(def: PluginDef): boolean {
  const { hookFile, pluginDirMatch, settingsMarker } = def.detect;
  if (hookFile && fs.existsSync(path.join(CLAUDE_DIR, "hooks", hookFile))) return true;
  try {
    const m = pluginDirMatch.toLowerCase();
    const walk = (dir: string, depth: number): boolean => {
      if (depth > 3) return false;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        if (e.name.toLowerCase().includes(m)) return true;
        if (walk(path.join(dir, e.name), depth + 1)) return true;
      }
      return false;
    };
    if (walk(path.join(CLAUDE_DIR, "plugins"), 0)) return true;
  } catch {
    /* no plugins dir */
  }
  try {
    const s = fs.readFileSync(path.join(CLAUDE_DIR, "settings.json"), "utf8");
    if (s.includes(settingsMarker)) return true;
  } catch {
    /* no settings.json */
  }
  return false;
}

export type PluginView = {
  id: PluginId;
  name: string;
  repo: string;
  blurb: string;
  modes: PluginMode[];
  install: string;
  caveat?: string;
  installed: boolean;
  // the effective default a NEW session would use: env > file > the plugin's own
  // 'full' default. `mode` is what we render; `on` = it's not "off".
  mode: string;
  on: boolean;
  // when the env var is set it WINS over our file — non-null = our toggle is
  // shadowed; the UI warns and names it.
  envOverride: { name: string; value: string } | null;
  configPath: string;
};

export function viewOf(def: PluginDef): PluginView {
  const env = process.env[def.envVar];
  const envOverride = env ? { name: def.envVar, value: env.toLowerCase() } : null;
  const mode = (envOverride?.value ?? fileMode(def) ?? PLUGIN_DEFAULT).toLowerCase();
  return {
    id: def.id,
    name: def.name,
    repo: def.repo,
    blurb: def.blurb,
    modes: def.modes,
    install: def.install,
    caveat: def.caveat,
    installed: isInstalled(def),
    mode,
    on: mode !== "off",
    envOverride,
    configPath: configPath(def),
  };
}

export function getPluginViews(): PluginView[] {
  return PLUGINS.map(viewOf);
}

// Write `{ "defaultMode": <mode> }` to the plugin's config — matching ponytail's
// own writeDefaultMode() shape — and return the fresh view (a read-back, so the
// caller sees exactly what landed on disk). Throws on an unknown id/mode.
export function setPluginMode(id: string, mode: string): PluginView {
  const def = PLUGINS.find((p) => p.id === id);
  if (!def) throw new Error(`unknown plugin: ${id}`);
  const m = String(mode).toLowerCase();
  if (!def.modes.some((x) => x.id === m)) throw new Error(`invalid mode for ${id}: ${mode}`);
  writeFileAtomicSync(configPath(def), JSON.stringify({ defaultMode: m }, null, 2) + "\n");
  return viewOf(def);
}
