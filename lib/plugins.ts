import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomicSync } from "@/lib/atomic";

// HQ's curated library of Claude Code agent add-ons — toggle or run them here
// instead of cloning GitHub repos. Two categories:
//
//   • PLUGINS — hook into the agent and change its BEHAVIOR. ponytail (write less
//     code) + caveman (terse output) expose a global `defaultMode` config we
//     write to flip them off/lite/full/ultra; impeccable (design quality) is
//     project-scoped (install + /impeccable commands), so it gets an install
//     affordance only — no global mode toggle to fake.
//   • TOOLS — you RUN or FETCH them to add capability/context, not toggle:
//     skillui (a CLI that extracts a site's design system into a Claude skill)
//     and awesome-design-md (a pack of 70+ brand DESIGN.md files to drop in).
//
// Install/run is a TOGGLE that PREFILLS the command into the terminal send box
// (the user hits enter) — `/plugin …` is interactive and can't run headless.
// The mode toggle (ponytail/caveman) writes the verified `defaultMode` config
// (XDG-first, atomic) and lands on the NEXT session (hooks load at init). An env
// override (…_DEFAULT_MODE) BEATS the file — surfaced as a warning.

export type Category = "plugin" | "tool";
// How a card behaves: a mode segmented control (once installed), an install
// prefill, a run prefill, or just a browse-on-GitHub link.
export type Affordance = "modes" | "install" | "run" | "browse";
export type PluginMode = { id: string; label: string; desc: string };

type Detect = {
  hookFile?: string; // ~/.claude/hooks/<file>
  pluginDirMatch?: string; // a dir-name fragment under ~/.claude/plugins
  settingsMarker?: string; // a substring in ~/.claude/settings.json
  skillDir?: string; // a dir under ~/.claude/skills
};

export type LibDef = {
  id: string;
  name: string;
  repo: string; // owner/name on GitHub
  blurb: string;
  category: Category;
  affordance: Affordance;
  command?: string; // the send-box prefill (install/run); browse uses the repo url
  // install is an interactive /plugin flow — run it in a real Claude Code TUI, not
  // hq's send box (the agent can't execute user slash commands). Shell installers
  // (npx/curl) DO run on enter, via the agent's Bash.
  interactive?: boolean;
  // one-click install: drive a real `claude` PTY (via tmux) through
  // `/plugin marketplace add <marketplace>` + `/plugin install <ref>`. Present →
  // the card shows a real Install button (vs injecting the command in the box).
  tmuxInstall?: { marketplace: string; ref: string };
  modes?: PluginMode[]; // affordance "modes" only — "off" is always first
  configDir?: string; // ~/.config/<configDir>/config.json (XDG_CONFIG_HOME first)
  envVar?: string; // the override that beats the file — surfaced as a warning
  detect?: Detect; // any sentinel hit → installed
  caveat?: string;
};

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const XDG = process.env.XDG_CONFIG_HOME || path.join(HOME, ".config");
const PLUGIN_DEFAULT = "full"; // ponytail + caveman both ship `full` as the default

export const PLUGINS: LibDef[] = [
  {
    id: "ponytail",
    name: "Ponytail",
    repo: "DietrichGebert/ponytail",
    blurb: "Writes less code — runs a YAGNI decision ladder before the agent generates anything.",
    category: "plugin",
    affordance: "modes",
    command:
      "/plugin marketplace add DietrichGebert/ponytail && /plugin install ponytail@ponytail",
    interactive: true, // /plugin-only for Claude Code — run in an interactive TUI
    tmuxInstall: { marketplace: "DietrichGebert/ponytail", ref: "ponytail@ponytail" },
    modes: [
      { id: "off", label: "Off", desc: "no influence" },
      { id: "lite", label: "Lite", desc: "a gentle nudge" },
      { id: "full", label: "Full", desc: "the standard ladder" },
      { id: "ultra", label: "Ultra", desc: "ruthless minimalism" },
    ],
    configDir: "ponytail",
    envVar: "PONYTAIL_DEFAULT_MODE",
    detect: { pluginDirMatch: "ponytail", settingsMarker: "ponytail-activate" },
  },
  {
    id: "caveman",
    name: "Caveman",
    repo: "JuliusBrussee/caveman",
    blurb: "Compresses the agent's output ~65% — terse, telegraphic, still correct.",
    category: "plugin",
    affordance: "modes",
    // the shell installer (not `/plugin`) — the agent runs this via Bash on enter.
    command: "curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh | bash",
    tmuxInstall: { marketplace: "JuliusBrussee/caveman", ref: "caveman@caveman" },
    modes: [
      { id: "off", label: "Off", desc: "normal prose" },
      { id: "lite", label: "Lite", desc: "drops filler" },
      { id: "full", label: "Full", desc: "telegraphic" },
      { id: "ultra", label: "Ultra", desc: "maximal compression" },
      { id: "wenyan", label: "Wényán", desc: "classical Chinese" },
    ],
    configDir: "caveman",
    envVar: "CAVEMAN_DEFAULT_MODE",
    detect: { hookFile: "caveman-activate.js", pluginDirMatch: "caveman", settingsMarker: "caveman-activate" },
    caveat: "A repo-local .caveman/config.json overrides this global default inside that repo.",
  },
  {
    id: "impeccable",
    name: "Impeccable",
    repo: "pbakaus/impeccable",
    blurb: "Frontend-design quality for AI agents — 23 commands + 44 detector rules that flag design anti-patterns as you edit.",
    category: "plugin",
    affordance: "install",
    command: "npx impeccable install",
    detect: { skillDir: "impeccable", pluginDirMatch: "impeccable", settingsMarker: "impeccable" },
    caveat: "Project-scoped: once installed, drive it with /impeccable commands + a per-project .impeccable/config.json (no global on/off).",
  },
  {
    id: "skillui",
    name: "SkillUI",
    repo: "amaancoderx/npxskillui",
    blurb: "Reverse-engineers any site's design system into a Claude-ready skill — pure static analysis, no API keys.",
    category: "tool",
    affordance: "run",
    command: "npx skillui --url https://stripe.com",
  },
  {
    id: "awesome-design-md",
    name: "Awesome DESIGN.md",
    repo: "voltagent/awesome-design-md",
    blurb: "A pack of 70+ brand DESIGN.md files (Claude, Stripe, Apple, Figma…) — drop one into a project so the agent matches that look.",
    category: "tool",
    affordance: "browse",
  },
];

function configPath(def: LibDef): string {
  return path.join(XDG, def.configDir ?? def.id, "config.json");
}

function fileMode(def: LibDef): string | null {
  try {
    const v = JSON.parse(fs.readFileSync(configPath(def), "utf8"))?.defaultMode;
    return typeof v === "string" ? v.toLowerCase() : null;
  } catch {
    return null;
  }
}

// Any sentinel hit → installed. No single universal marker across plugin-install
// vs standalone-hooks vs skill installs, so we OR them.
function isInstalled(def: LibDef): boolean {
  const d = def.detect;
  if (!d) return false;
  if (d.hookFile && fs.existsSync(path.join(CLAUDE_DIR, "hooks", d.hookFile))) return true;
  if (d.skillDir && fs.existsSync(path.join(CLAUDE_DIR, "skills", d.skillDir))) return true;
  if (d.pluginDirMatch) {
    try {
      const m = d.pluginDirMatch.toLowerCase();
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
  }
  if (d.settingsMarker) {
    try {
      if (fs.readFileSync(path.join(CLAUDE_DIR, "settings.json"), "utf8").includes(d.settingsMarker))
        return true;
    } catch {
      /* no settings.json */
    }
  }
  return false;
}

export type LibView = {
  id: string;
  name: string;
  repo: string;
  blurb: string;
  category: Category;
  affordance: Affordance;
  command?: string;
  interactive?: boolean;
  oneClick: boolean; // a real Install button (tmux-driven) vs injecting the command
  modes?: PluginMode[];
  installed: boolean;
  // For "modes" plugins: the effective default a NEW session would use, but ONLY
  // once installed — null when not installed (an uninstalled plugin has no mode,
  // so the card never claims "ON · FULL"). env > file > the plugin's `full`.
  mode: string | null;
  on: boolean;
  envOverride: { name: string; value: string } | null;
  caveat?: string;
  configPath?: string;
};

export function viewOf(def: LibDef): LibView {
  const installed = isInstalled(def);
  const base: LibView = {
    id: def.id,
    name: def.name,
    repo: def.repo,
    blurb: def.blurb,
    category: def.category,
    affordance: def.affordance,
    command: def.command,
    interactive: def.interactive,
    oneClick: !!def.tmuxInstall,
    modes: def.modes,
    installed,
    mode: null,
    on: false,
    envOverride: null,
    caveat: def.caveat,
  };
  if (def.affordance !== "modes") return base;
  // a behavior plugin with a global defaultMode — only meaningful once installed.
  base.configPath = configPath(def);
  if (!installed) return base; // no mode/on until it's actually on disk (the ON·FULL fix)
  const env = def.envVar ? process.env[def.envVar] : undefined;
  base.envOverride = env ? { name: def.envVar!, value: env.toLowerCase() } : null;
  base.mode = (base.envOverride?.value ?? fileMode(def) ?? PLUGIN_DEFAULT).toLowerCase();
  base.on = base.mode !== "off";
  return base;
}

export function getPluginViews(): LibView[] {
  return PLUGINS.map(viewOf);
}

// Write `{ "defaultMode": <mode> }` to a plugin's config — matching ponytail's
// own writeDefaultMode() shape — and return the fresh, read-back view. Throws on
// an unknown id, a non-"modes" entry, or an invalid mode.
export function setPluginMode(id: string, mode: string): LibView {
  const def = PLUGINS.find((p) => p.id === id);
  if (!def) throw new Error(`unknown plugin: ${id}`);
  if (def.affordance !== "modes") throw new Error(`${id} has no mode toggle`);
  const m = String(mode).toLowerCase();
  if (!def.modes!.some((x) => x.id === m)) throw new Error(`invalid mode for ${id}: ${mode}`);
  writeFileAtomicSync(configPath(def), JSON.stringify({ defaultMode: m }, null, 2) + "\n");
  return viewOf(def);
}
