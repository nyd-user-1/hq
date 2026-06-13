import fs from "node:fs";
import { sessionFilePath, latestSessionId } from "./transcript";
import { premiumBleed, contextCarryCost } from "./pricing";
import { PRICING_CLIFF } from "./limits";

// Efficiency Mode's money conscience for ONE session — pure measurement, read
// from the transcript. It does NOT touch the session (HQ can't compact a live
// session from outside — confirmed). It just makes the money visible:
//   • bled       — REAL extra $ paid this session because calls ran past the
//                  200k cliff (sum of the per-call premium).
//   • compactions — context-token drops between calls = Claude Code auto-
//                  compacted (or you /cleared); we price what those trims save.
// Estimates throughout (see pricing.ts); a decision meter, not an invoice.

const TAIL_BYTES = 8 * 1024 * 1024;
const DROP_TOKENS = 40_000; // a fall this big = a compaction, not normal growth
const DROP_RATIO = 0.7; // …and the new size is <70% of the prior

export type Efficiency = {
  id: string | null;
  contextTokens: number; // current context size
  pastCliff: boolean;
  premiumPerTurn: number; // est $ THIS turn costs extra from being past the cliff
  bledTotal: number; // est $ extra paid this session from cliff calls (summed)
  compactionCount: number;
  trimmedTokens: number; // total tokens removed by compactions this session
  savedPerTurn: number; // est $ each turn now saves thanks to those trims
};

type CallRec = {
  model?: string;
  input: number;
  cw: number;
  cr: number;
  out: number;
  context: number;
};

const empty = (id: string | null): Efficiency => ({
  id,
  contextTokens: 0,
  pastCliff: false,
  premiumPerTurn: 0,
  bledTotal: 0,
  compactionCount: 0,
  trimmedTokens: 0,
  savedPerTurn: 0,
});

export function efficiencyFor(id: string | null): Efficiency {
  const sid = id && id !== "new" ? id : latestSessionId();
  if (!sid) return empty(null);

  let text: string;
  let partial = false;
  try {
    const file = sessionFilePath(sid);
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - TAIL_BYTES);
    partial = start > 0;
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch {
    return empty(sid);
  }

  const lines = text.split("\n");
  if (partial) lines.shift();

  // One record per API message, in order, deduped by message id (streaming
  // writes the same usage block several times — last write wins).
  const calls: CallRec[] = [];
  let lastId: string | null = null;
  for (const line of lines) {
    if (!line.includes('"usage"')) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type !== "assistant") continue;
    const u = e.message?.usage;
    if (!u) continue;
    const rec: CallRec = {
      model: e.message?.model,
      input: u.input_tokens ?? 0,
      cw: u.cache_creation_input_tokens ?? 0,
      cr: u.cache_read_input_tokens ?? 0,
      out: u.output_tokens ?? 0,
      context: 0,
    };
    rec.context = rec.input + rec.cw + rec.cr + rec.out;
    const mid = e.message?.id ?? null;
    if (mid && mid === lastId) calls[calls.length - 1] = rec; // streaming dupe
    else calls.push(rec);
    lastId = mid;
  }

  if (calls.length === 0) return empty(sid);

  let bledTotal = 0;
  let compactionCount = 0;
  let trimmedTokens = 0;
  let prevContext = 0;
  for (const c of calls) {
    bledTotal += premiumBleed({
      model: c.model,
      input: c.input,
      cacheCreate: c.cw,
      cacheRead: c.cr,
      output: c.out,
    });
    if (
      prevContext > 0 &&
      prevContext - c.context > DROP_TOKENS &&
      c.context < prevContext * DROP_RATIO
    ) {
      compactionCount++;
      trimmedTokens += prevContext - c.context;
    }
    prevContext = c.context;
  }

  const last = calls[calls.length - 1];
  const contextTokens = last.context;
  const contextInput = last.input + last.cw + last.cr;
  const pastCliff = contextInput > PRICING_CLIFF;
  const premiumPerTurn = premiumBleed({
    model: last.model,
    input: last.input,
    cacheCreate: last.cw,
    cacheRead: last.cr,
    output: last.out,
  });
  const savedPerTurn = contextCarryCost(trimmedTokens, last.model, pastCliff);

  return {
    id: sid,
    contextTokens,
    pastCliff,
    premiumPerTurn,
    bledTotal,
    compactionCount,
    trimmedTokens,
    savedPerTurn,
  };
}
