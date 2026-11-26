// The autonomous-scheduler workflow's `plan` job checks out only the paths in its sparse-checkout list. This test
// (1) checks every file scheduler-step.mts imports at load time is in that list, and (2) actually runs
// `scheduler-step.mts plan` from a copy holding ONLY those paths, against a fake app, so the job can never fail with
// ERR_MODULE_NOT_FOUND again. Run: npm run test:unit
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { ROOT } from "./importGraph.mts";

const run = promisify(execFile);
const WORKFLOW = path.join(ROOT, ".github/workflows/autonomous-scheduler.yml");

/** The plan job's sparse-checkout paths (a `|` block or a single value). */
function sparsePaths(): string[] {
  const wf = fs.readFileSync(WORKFLOW, "utf8");
  const plan = wf.slice(wf.indexOf("\n  plan:"), wf.indexOf("\n  produce:"));
  const m = /sparse-checkout:\s*\|\n((?:\s{12}\S.*\n)+)|sparse-checkout:\s*(\S+)/.exec(plan);
  assert.ok(m, "the plan job has a sparse-checkout list");
  return (m[1] ?? m[2]).split("\n").map((s) => s.trim()).filter(Boolean);
}

/** Files loaded when scheduler-step.mts starts: static imports only (dynamic import() runs inside subcommands). */
function loadTimeImports(entry: string, seen = new Set<string>()): Set<string> {
  const file = path.join(ROOT, entry);
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']/gm)) {
    if (m[1] || !m[2].startsWith(".")) continue; // type-only imports are erased; node: built-ins and packages aren't files
    loadTimeImports(path.relative(ROOT, path.resolve(path.dirname(file), m[2])), seen);
  }
  return seen;
}

test("every file scheduler-step.mts loads at start-up is in the plan job's sparse checkout", () => {
  const sparse = sparsePaths();
  const needed = [...loadTimeImports("video/scheduler-step.mts")];
  assert.deepEqual(needed, ["video/scheduler-step.mts"], "only node: built-ins at the top; stage modules load in prepare");
  for (const f of needed) assert.ok(sparse.includes(f), `${f} is missing from the plan job's sparse-checkout`);
  // the stage modules are still used, dynamically, by prepare
  const src = fs.readFileSync(path.join(ROOT, "video/scheduler-step.mts"), "utf8");
  for (const mod of ["./edge-stage.mts", "./prop-stage.mts", "./slot-progress.mts", "../src/lib/slotProgress.ts"]) assert.ok(src.includes(`import("${mod}")`), mod);
});

test("`scheduler-step.mts plan` runs from a checkout holding only the sparse paths (no ERR_MODULE_NOT_FOUND)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-sparse-"));
  for (const f of sparsePaths()) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  const seen: { url?: string; auth?: string }[] = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ slots: ["11111111-2222-4333-8444-555555555555"], notes: ["2 slot(s) added"] }));
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const out = path.join(dir, "gh-output.txt");
  try {
    const r = await run(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), path.join(dir, "video/scheduler-step.mts"), "plan"], {
      cwd: dir,
      // a clean environment, like the CI runner: none of this test runner's tsx settings (its --tsconfig) leak in
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("TSX_") && k !== "NODE_OPTIONS")), RENDER_TOKEN: "t", APP_URL: `http://127.0.0.1:${port}`, GITHUB_OUTPUT: out },
    });
    assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module/);
    assert.match(r.stdout, /producing 1 slot\(s\)/);
    assert.equal(fs.readFileSync(out, "utf8"), 'slots=["11111111-2222-4333-8444-555555555555"]\ncount=1\n');
    assert.deepEqual(seen, [{ url: "/api/scheduler/tick", auth: "Bearer t" }]);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
