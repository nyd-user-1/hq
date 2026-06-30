import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// SETTINGS — a read-only, structured view of ~/.claude/settings.json, the
// user-global Claude Code config. hq's thesis is "read what's on disk": this
// surfaces the machine's configuration grouped into readable sections (general
// prefs, permissions summary, hooks, statusLine, plugins, env) plus the raw
// JSON. Pure node:fs, defensive — a missing or unparseable file returns an
// empty-but-valid summary, never throws.
//
// SECRETS: any env value whose KEY or VALUE looks like a token/key/secret is
// masked AT THE SOURCE — the verbatim value never leaves the server, neither in
// the structured rows nor in the raw JSON dump.

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const SETTINGS = path.join(CLAUDE_DIR, "settings.json");

const SECRET_RE = /TOKEN|KEY|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL|BEARER/i;

export type SettingRow = { key: string; value: string; masked?: boolean };
export type SettingsSection = { title: string; rows: SettingRow[] };

export type SettingsSummary = {
  path: string;
  exists: boolean;
  sections: SettingsSection[];
  raw: string; // pretty-printed JSON, with any secret-looking env values masked
  error?: string;
};

// Looks like a secret if the key signals one, OR the value is a long opaque
// blob with no spaces (typical of API keys / tokens).
function looksSecret(key: string, value: string): boolean {
  if (SECRET_RE.test(key)) return true;
  return value.length >= 20 && !/\s/.test(value) && /[A-Za-z0-9_\-]{20,}/.test(value);
}

// Show presence without leaking content: reveal the last 4 of long values, all
// dots for short ones — enough to confirm "it's set" without exposing it.
function mask(value: string): string {
  if (value.length <= 8) return "••••••••";
  return "••••" + value.slice(-4);
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
  if (typeof v === "object") return `${Object.keys(v as object).length} key${Object.keys(v as object).length === 1 ? "" : "s"}`;
  return String(v);
}

type AnyObj = Record<string, unknown>;

export function getSettings(): SettingsSummary {
  let parsed: AnyObj | null = null;
  let exists = false;
  let error: string | undefined;
  try {
    const text = fs.readFileSync(SETTINGS, "utf8");
    exists = true;
    parsed = JSON.parse(text) as AnyObj;
  } catch (e) {
    if (exists) error = e instanceof Error ? e.message : "unparseable settings.json";
    parsed = null;
  }

  if (!parsed) {
    return { path: SETTINGS, exists, sections: [], raw: "", error: error ?? (exists ? undefined : "settings.json not found") };
  }

  const s = parsed;
  const sections: SettingsSection[] = [];

  // — General — every scalar (string/number/boolean) top-level key, A–Z.
  const generalRows: SettingRow[] = [];
  for (const [k, v] of Object.entries(s)) {
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
      generalRows.push({ key: k, value: fmt(v) });
    }
  }
  generalRows.sort((a, b) => a.key.localeCompare(b.key));
  if (generalRows.length) sections.push({ title: "General", rows: generalRows });

  // — Permissions — a summary (the full control surface lives in the Permissions panel).
  const perm = (s.permissions ?? {}) as AnyObj;
  if (s.permissions) {
    sections.push({
      title: "Permissions",
      rows: [
        { key: "defaultMode", value: fmt(perm.defaultMode ?? "default") },
        { key: "allow", value: `${(perm.allow as unknown[] | undefined)?.length ?? 0} rules` },
        { key: "ask", value: `${(perm.ask as unknown[] | undefined)?.length ?? 0} rules` },
        { key: "deny", value: `${(perm.deny as unknown[] | undefined)?.length ?? 0} rules` },
      ],
    });
  }

  // — Hooks — one row per lifecycle event, value = how many commands fire on it.
  if (s.hooks && typeof s.hooks === "object") {
    const hooks = s.hooks as Record<string, unknown>;
    const rows: SettingRow[] = Object.entries(hooks).map(([event, groups]) => {
      const n = Array.isArray(groups)
        ? (groups as { hooks?: unknown[] }[]).reduce((acc, g) => acc + (Array.isArray(g?.hooks) ? g.hooks.length : 0), 0)
        : 0;
      return { key: event, value: `${n} command${n === 1 ? "" : "s"}` };
    });
    if (rows.length) sections.push({ title: "Hooks", rows });
  }

  // — Status line —
  if (s.statusLine && typeof s.statusLine === "object") {
    const sl = s.statusLine as AnyObj;
    sections.push({
      title: "Status line",
      rows: [
        { key: "type", value: fmt(sl.type) },
        { key: "command", value: fmt(sl.command) },
      ],
    });
  }

  // — Plugins — counts only (the Plugins panel is the browser).
  const pluginRows: SettingRow[] = [];
  if (s.enabledPlugins && typeof s.enabledPlugins === "object")
    pluginRows.push({ key: "enabledPlugins", value: `${Object.keys(s.enabledPlugins as object).length} enabled` });
  if (s.extraKnownMarketplaces && typeof s.extraKnownMarketplaces === "object")
    pluginRows.push({ key: "extraKnownMarketplaces", value: `${Object.keys(s.extraKnownMarketplaces as object).length} marketplaces` });
  if (pluginRows.length) sections.push({ title: "Plugins", rows: pluginRows });

  // — Environment — settings.json's own `env` block (NOT process env; that's the
  // Environment panel). Secret-looking values masked at the source.
  if (s.env && typeof s.env === "object") {
    const env = s.env as Record<string, unknown>;
    const rows: SettingRow[] = Object.entries(env).map(([k, v]) => {
      const val = typeof v === "string" ? v : fmt(v);
      const secret = typeof v === "string" && looksSecret(k, v);
      return secret ? { key: k, value: mask(val), masked: true } : { key: k, value: val };
    });
    if (rows.length) sections.push({ title: "Env (settings.json)", rows });
  }

  // — Raw JSON — a masked deep copy so the collapsible can't leak a secret.
  const safeCopy: AnyObj = JSON.parse(JSON.stringify(s));
  if (safeCopy.env && typeof safeCopy.env === "object") {
    const env = safeCopy.env as Record<string, unknown>;
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === "string" && looksSecret(k, v)) env[k] = mask(v);
    }
  }

  return { path: SETTINGS, exists: true, sections, raw: JSON.stringify(safeCopy, null, 2), error };
}
