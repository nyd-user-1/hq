import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getFilesMeta } from "./files-meta";
import { getSessionsMeta } from "./sessions-meta";
import { filesIndex } from "./files-index";
import { timelineFor } from "./transcript";

// The unified Favorites surface — one place for everything starred, no matter
// where it was starred. Aggregates the THREE favorite stores so "favorite a
// response" means one thing everywhere:
//   • files-meta  (kind:ref) — the cmdk reader ★ (notes/memory/sessions/skills)
//   • sessions-meta (id)     — the sidebar Recents star
//   • block-meta (session→uuid) — the chat-stream per-turn ★ → kind "turn"
export type FavItem = {
  kind: string;
  ref: string;
  title: string;
  snippet: string;
  at: number;
  meta?: string;
};

const BLOCK_META = path.join(os.homedir(), ".claude", "hq", "block-meta.json");

function readBlocks(): Record<string, Record<string, { favorite?: boolean }>> {
  try {
    const p = JSON.parse(fs.readFileSync(BLOCK_META, "utf8"));
    return (p?.blocks ?? p) || {};
  } catch {
    return {};
  }
}

export function getFavorites(): FavItem[] {
  const out: FavItem[] = [];
  const seen = new Set<string>();
  const push = (it: FavItem) => {
    const k = `${it.kind}:${it.ref}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(it);
    }
  };

  const idx = filesIndex();
  const byKey = new Map(idx.map((r) => [`${r.kind}:${r.ref}`, r]));
  const byRef = new Map(idx.map((r) => [r.ref, r]));

  // cmdk stars
  for (const [key, m] of Object.entries(getFilesMeta())) {
    if (!m.favorite) continue;
    const r = byKey.get(key);
    const i = key.indexOf(":");
    push({
      kind: key.slice(0, i),
      ref: key.slice(i + 1),
      title: m.title || r?.name || key.slice(i + 1),
      snippet: r?.file ?? "",
      at: r?.modified ?? 0,
      meta: r?.meta,
    });
  }
  // sidebar session stars
  for (const [id, m] of Object.entries(getSessionsMeta())) {
    if (!m.favorite) continue;
    const r = byRef.get(id);
    push({
      kind: r?.kind || "session",
      ref: id,
      title: m.title || r?.name || id,
      snippet: r?.file ?? "",
      at: r?.modified ?? 0,
      meta: r?.meta,
    });
  }
  // chat-turn stars — read each session-with-favorites' timeline once, match uuids
  for (const [session, map] of Object.entries(readBlocks())) {
    if (!map || typeof map !== "object") continue;
    const favUuids = Object.entries(map)
      .filter(([, v]) => v?.favorite)
      .map(([k]) => k);
    if (!favUuids.length) continue;
    let items: { uuid?: string; text?: string; at?: string; role?: string }[] = [];
    try {
      items = (timelineFor(session, 1000).items as typeof items) ?? [];
    } catch {
      /* transcript gone */
    }
    const byUuid = new Map(items.filter((t) => t.uuid).map((t) => [t.uuid!, t]));
    for (const uuid of favUuids) {
      const t = byUuid.get(uuid);
      const text = (t?.text ?? "").trim();
      push({
        kind: "turn",
        ref: `${session}/${uuid}`,
        title: text ? text.slice(0, 90) : "Turn",
        snippet: t?.role ? `${t.role} turn` : "turn",
        at: t?.at ? Date.parse(t.at) : 0,
        meta: session.slice(0, 8),
      });
    }
  }

  out.sort((a, b) => b.at - a.at);
  return out;
}
