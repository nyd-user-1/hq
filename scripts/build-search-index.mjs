// Builds the Session Archive search index OUT OF PROCESS so the 2GB extract
// never blocks the dev server's event loop (the terminal polls every 1s).
// Incremental: reuses unchanged entries from the previous index by mtime.
// Output: ~/.claude/hq-archive-index.json = { builtMaxMtime, entries:[{file,id,mtime,text}] }.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const ROOT = path.join(os.homedir(), ".claude", "projects");
const OUT = path.join(os.homedir(), ".claude", "hq-archive-index.json");

// Same cleaning as lib/sessions.cleanText — strip system-reminders (else every
// session matches common project terms from the injected memory index) + tags.
function cleanText(t) {
  return t
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function extract(file) {
  let out = "";
  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(file),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line || line[0] !== "{") continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.type !== "user" && e.type !== "assistant") continue;
      const c = e.message?.content;
      if (typeof c === "string") out += cleanText(c) + "\n";
      else if (Array.isArray(c))
        for (const b of c)
          if (b?.type === "text" && b.text) out += cleanText(b.text) + "\n";
    }
  } catch {
    // unreadable
  }
  return out.toLowerCase();
}

const prev = new Map();
try {
  const j = JSON.parse(fs.readFileSync(OUT, "utf8"));
  for (const e of j.entries) prev.set(e.file, e);
} catch {
  // no prior index — full build
}

const entries = [];
let builtMaxMtime = 0;
let dirs = [];
try {
  dirs = fs.readdirSync(ROOT, { withFileTypes: true });
} catch {
  dirs = [];
}
for (const d of dirs) {
  if (!d.isDirectory()) continue;
  const dp = path.join(ROOT, d.name);
  let names = [];
  try {
    names = fs.readdirSync(dp);
  } catch {
    continue;
  }
  for (const f of names) {
    if (!f.endsWith(".jsonl")) continue;
    const full = path.join(dp, f);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size === 0) continue;
    if (st.mtimeMs > builtMaxMtime) builtMaxMtime = st.mtimeMs;
    const p = prev.get(full);
    if (p && p.mtime === st.mtimeMs) {
      entries.push(p);
      continue;
    }
    entries.push({
      file: full,
      id: path.basename(full, ".jsonl"),
      mtime: st.mtimeMs,
      text: await extract(full),
    });
  }
}

// Atomic write so the server never reads a half-built index.
const tmp = OUT + ".tmp";
fs.writeFileSync(tmp, JSON.stringify({ builtMaxMtime, entries }));
fs.renameSync(tmp, OUT);
