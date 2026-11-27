"use server";

import { getOwner } from "@/lib/queries";
import { getBooth } from "@/lib/recordings";
import { linesToVoice, asPreset, asProvider } from "@/lib/voice/acting";
import { voiceTake } from "@/lib/voice/providers";
import { getEpisodeVoice } from "@/lib/voice/settings";

export type AiResult = { ok: boolean; message: string } | null;

/**
 * AI voice for an episode, with the episode's voice provider (Gemini TTS, free, by default) and delivery preset:
 * every line without a take (mode "missing"), or one line again with an optional extra direction (mode "line").
 * Lines that already have audio are never voiced again by "missing": cached takes stay, so re-renders cost nothing.
 */
export async function generateAiTakesAction(projectId: string, _prev: AiResult, form: FormData): Promise<AiResult> {
  try {
    const owner = await getOwner();
    if (!owner) return { ok: false, message: "No user found." };
    const booth = await getBooth(owner.id, projectId);
    if (!booth?.script) return { ok: false, message: "No script to voice yet." };
    const mode = form.get("mode") === "line" ? "line" : "missing";
    const extra = String(form.get("extra") ?? "").trim() || undefined;
    const targets = linesToVoice(booth.lines, (i) => Boolean(booth.recorded[i]), mode, Number(form.get("lineIndex")));
    const saved = await getEpisodeVoice(projectId);
    // the booth's picker sends its current choice, so a change applies right away
    const provider = form.has("provider") ? asProvider(form.get("provider")) : saved.provider;
    const preset = form.has("preset") ? asPreset(form.get("preset")) : saved.preset;
    if (!targets.length) return { ok: true, message: "Every line already has a take." };

    let done = 0;
    const errors: string[] = [];
    // 3 at a time: fast enough for ~17 lines within the time limit, gentle on the API.
    for (let i = 0; i < targets.length; i += 3) {
      const results = await Promise.all(
        targets.slice(i, i + 3).map((l) =>
          voiceTake({ userId: owner.id, projectId, scriptId: booth.script!.id, lineIndex: l.index, line: l, extra, provider, preset }).catch((e: Error) => ({ ok: false as const, message: e.message })),
        ),
      );
      for (const r of results) {
        if (r.ok) done++;
        else errors.push(r.message);
      }
      if (errors.length && done === 0) break; // first batch failed entirely: stop, same error would repeat
    }
    if (errors.length) return { ok: done > 0, message: `${done} line(s) voiced. Problem: ${errors[0]}` };
    return { ok: true, message: mode === "line" ? "New AI take ready. Listen to it in the line list." : `${done} line(s) voiced with ${provider === "gemini_tts" ? "Gemini TTS" : "ElevenLabs"}.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * One line voiced again with the given provider and delivery: the same single-line path as "Redo one line with AI"
 * (voiceTake: #63's acronym map, paced 429 retries, #64's tail trimmer), driven line by line from the booth's
 * "Redo all". The new take is added to the line's takes and made its selected take; an Own Voice take is stored as a
 * Gemini base take, so the next render converts it with RVC again. Never called by "missing" voicing or the render.
 */
export async function redoLineAction(projectId: string, lineIndex: number, provider: string, preset: string): Promise<{ ok: boolean; message: string }> {
  try {
    const owner = await getOwner();
    if (!owner) return { ok: false, message: "No user found." };
    const booth = await getBooth(owner.id, projectId);
    if (!booth?.script) return { ok: false, message: "No script to voice yet." };
    const [line] = linesToVoice(booth.lines, () => true, "line", Number(lineIndex));
    if (!line) return { ok: false, message: `Line ${Number(lineIndex) + 1} isn't in the script.` };
    const r = await voiceTake({ userId: owner.id, projectId, scriptId: booth.script.id, lineIndex: line.index, line, provider: asProvider(provider), preset: asPreset(preset) });
    return r.ok ? { ok: true, message: `Line ${line.index + 1} voiced again.` } : { ok: false, message: r.message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
