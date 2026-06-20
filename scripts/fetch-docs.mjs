// Mirrors the Claude Code documentation into a local, offline best-practice
// corpus so HQ can consult Anthropic's canonical guidance with no network. Runs
// OUT OF PROCESS (like build-search-index.mjs) and writes to ~/.claude/hq/docs/.
//
// Source: https://code.claude.com/docs/llms.txt is an INDEX of ~150 pages, each
// fetchable as raw markdown at /docs/en/<path>.md. There is no single bundle, so
// we iterate. Pages are MDX — some embed big React components (e.g. the
// claude-directory ClaudeExplorer) — so we CLEAN to prose before storing: index
// the guidance, not the component code.
//
// Freshness: a manifest records each page's etag/last-modified; re-runs send
// conditional GETs and skip unchanged pages (304). Cheap to poll on startup.
//
// PUBLIC-LAUNCH NOTE: this caches Anthropic's docs LOCALLY for personal use. Do
// NOT commit the fetched bytes into the repo / npm package — ship this fetcher,
// not the docs.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

const INDEX_URL = "https://code.claude.com/docs/llms.txt";
const OUT_DIR = path.join(os.homedir(), ".claude", "hq", "docs");
const MANIFEST = path.join(OUT_DIR, "_manifest.json");
const UA = "hq-docs-mirror/1 (+localhost observability)";

// Strip MDX/JSX so we keep prose + markdown, not React component source.
function cleanMdx(text) {
  const lines = text.split("\n");
  const out = [];
  let depth = 0; // brace depth while skipping an export const/function block
  let skipping = false;
  for (const line of lines) {
    if (skipping) {
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (depth <= 0) skipping = false;
      continue;
    }
    if (/^\s*import\s.+from\s/.test(line)) continue; // drop import lines
    if (/^\s*export\s+(const|function|default)\b/.test(line)) {
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      depth = opens - closes;
      if (depth > 0) skipping = true; // multi-line component block
      continue;
    }
    out.push(line);
  }
  return out
    .join("\n")
    .replace(/<\/?[A-Z][A-Za-z0-9]*(\s[^>]*)?\/?>/g, "") // JSX component tags
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch {
    return { fetchedAt: 0, pages: {} };
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = readManifest();

  const idxRes = await fetch(INDEX_URL, { headers: { "user-agent": UA } });
  if (!idxRes.ok) throw new Error(`index fetch failed: ${idxRes.status}`);
  const idx = await idxRes.text();

  // Every fetchable page: https://code.claude.com/docs/en/<path>.md
  const urls = [
    ...new Set((idx.match(/https:\/\/code\.claude\.com\/docs\/en\/[^\s)]+\.md/g) || [])),
  ];

  let fetched = 0,
    skipped = 0,
    failed = 0;
  for (const url of urls) {
    const rel = url.replace("https://code.claude.com/docs/en/", ""); // e.g. agent-sdk/overview.md
    const prior = manifest.pages[rel] || {};
    const headers = { "user-agent": UA };
    if (prior.etag) headers["if-none-match"] = prior.etag;
    if (prior.lastModified) headers["if-modified-since"] = prior.lastModified;
    try {
      const res = await fetch(url, { headers });
      if (res.status === 304) {
        skipped++;
        continue;
      }
      if (!res.ok) {
        failed++;
        continue;
      }
      const raw = await res.text();
      const cleaned = cleanMdx(raw);
      const dest = path.join(OUT_DIR, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, cleaned);
      manifest.pages[rel] = {
        etag: res.headers.get("etag") || "",
        lastModified: res.headers.get("last-modified") || "",
        bytes: cleaned.length,
        hash: createHash("sha1").update(cleaned).digest("hex").slice(0, 12),
      };
      fetched++;
    } catch {
      failed++;
    }
  }

  manifest.fetchedAt = Date.now();
  manifest.pageCount = Object.keys(manifest.pages).length;
  const tmp = MANIFEST + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  fs.renameSync(tmp, MANIFEST);
  console.log(
    `docs mirror: ${fetched} fetched, ${skipped} unchanged, ${failed} failed · ${manifest.pageCount} pages cached in ${OUT_DIR}`
  );
}

main().catch((e) => {
  console.error("fetch-docs failed:", e.message);
  process.exit(1);
});
