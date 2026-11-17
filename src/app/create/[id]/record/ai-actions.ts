"use server";

import { getOwner } from "@/lib/queries";
import { getBooth } from "@/lib/recordings";
import { aiTake } from "@/lib/voice/profiles";

export type AiResult = { ok: boolean; message: string } | null;

/**
 * AI voice for an episode: every line without a take (mode "missing"), or one line again with an optional extra
 * direction (mode "line"). Your own recorded takes are never replaced unless you regenerate that line.
 */
export async function generateAiTakesAction(projectId: string, _prev: AiResult, form: FormData): Promise<AiResult> {
  try {
    const owner = await getOwner();
    if (!owner) return { ok: false, message: "No user found." };
    const booth = await getBooth(owner.id, projectId);
    if (!booth?.script) return { ok: false, message: "No script to voice yet." };
    const mode = form.get("mode") === "line" ? "line" : "missing";
    const extra = String(form.get("extra") ?? "").trim() || undefined;
    const targets =
      mode === "line"
        ? booth.lines.filter((l) => l.index === Number(form.get("lineIndex")))
        : booth.lines.filter((l) => !booth.recorded[l.index]);
    if (!targets.length) return { ok: true, message: "Every line already has a take." };

    let done = 0;
    const errors: string[] = [];
    // 3 at a time: fast enough for ~17 lines within the time limit, gentle on the API.
    for (let i = 0; i < targets.length; i += 3) {
      const results = await Promise.all(
        targets.slice(i, i + 3).map((l) =>
          aiTake({ userId: owner.id, projectId, scriptId: booth.script!.id, lineIndex: l.index, line: l, extra }).catch((e: Error) => ({ ok: false as const, message: e.message })),
        ),
      );
      for (const r of results) {
        if (r.ok) done++;
        else errors.push(r.message);
      }
      if (errors.length && done === 0) break; // first batch failed entirely: stop, same error would repeat
    }
    if (errors.length) return { ok: done > 0, message: `${done} line(s) voiced. Problem: ${errors[0]}` };
    return { ok: true, message: mode === "line" ? "New AI take ready. Listen to it in the line list." : `${done} line(s) voiced with AI.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
