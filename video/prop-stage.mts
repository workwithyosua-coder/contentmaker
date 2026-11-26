// Fresh props for a scheduled episode, in the autonomous scheduler worker. The app generates each prop with the Gemini
// image model (it holds GEMINI_API_KEY; the worker never does) and hands back a short-lived URL to the raw image; here
// scripts/prop_cutout.py removes the white background (edge flood fill, interior whites kept, 2 px defringe) and the
// transparent PNG goes up through a signed URL under the exact name the script's beats already use.
// A prop that fails anywhere is dropped (its beats show no prop), never swapped for an unrelated one; the slot goes on.
//
// Used by scheduler-step.mts (prepare). Env: EDGE_PYTHON (python with Pillow), PROP_FAKE_CUTOUT=1 (tests: copy as is)
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

type Post = <T>(path: string, body?: Record<string, unknown>) => Promise<T>;
const here = path.dirname(new URL(import.meta.url).pathname);

export async function propStage(p: { slotId: string; post: Post; log: (s: string) => void; base: string }): Promise<{ done: string[]; dropped: string[] }> {
  const done: string[] = [];
  const dropped: string[] = [];
  const plan = await p.post<{ props: { name: string; slug: string; prompt: string }[] }>(`slots/${p.slotId}/prop-plan`);
  if (!plan.props.length) {
    p.log("props: nothing to generate");
    return { done, dropped };
  }
  const work = path.join(here, "out", "props", p.slotId);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const drop = async (name: string, error: string) => {
    dropped.push(name);
    p.log(`prop ${name}: dropped to none (${error})`);
    await p.post(`slots/${p.slotId}/prop-finish`, { name, ok: false, error: error.slice(0, 280) }).catch(() => {});
  };
  for (const prop of plan.props) {
    try {
      p.log(`prop ${prop.name}: generating "${prop.prompt.slice(0, 80)}"`);
      const g = await p.post<{ ok: true; url: string; mime: string; model: string } | { ok: false; error: string }>(`slots/${p.slotId}/prop-generate`, { name: prop.name });
      if (!g.ok) {
        dropped.push(prop.name);
        p.log(`prop ${prop.name}: dropped to none (${g.error})`);
        continue;
      }
      const raw = path.join(work, `${prop.name}.raw`);
      const png = path.join(work, `${prop.name}.png`);
      const res = await fetch(new URL(g.url, p.base));
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
      if (process.env.PROP_FAKE_CUTOUT === "1") copyFileSync(raw, png);
      else {
        const python = process.env.EDGE_PYTHON?.trim() || "python3";
        const r = spawnSync(python, [path.resolve(here, "../scripts/prop_cutout.py"), raw, png], { encoding: "utf8" });
        if (r.status !== 0) throw new Error((r.stderr || r.stdout || `cut-out exit ${r.status}`).trim().slice(0, 200));
        p.log(`prop ${prop.name}: ${r.stdout.trim()}`);
      }
      const up = await p.post<{ url: string; path: string }>(`slots/${p.slotId}/prop-upload`, { name: prop.name });
      const put = await fetch(new URL(up.url, p.base), { method: "PUT", headers: { "Content-Type": "image/png", "x-upsert": "true" }, body: readFileSync(png) });
      if (!put.ok) throw new Error(`upload failed (${put.status})`);
      const f = await p.post<{ status: string }>(`slots/${p.slotId}/prop-finish`, { name: prop.name, ok: true });
      if (f.status === "done") {
        done.push(prop.name);
        p.log(`prop ${prop.name}: ready (${g.model})`);
      } else dropped.push(prop.name);
    } catch (e) {
      await drop(prop.name, e instanceof Error ? e.message : String(e));
    }
  }
  return { done, dropped };
}
