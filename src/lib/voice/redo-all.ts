// "Redo all N lines with AI" in the recording booth: every line that already has a take is voiced again, one line
// at a time, through the same single-line path as "Redo one line with AI" (each call its own short server request,
// so a 15-line Gemini run never hits a function timeout). Pure: the voicing call, the clock and the sleep are passed
// in, so the batch is unit-tested without a network. Nothing else re-voices a line that has audio: "Voice the
// missing lines" and the render keep every cached take.
import type { VoiceProvider } from "./acting";
import { TTS_MIN_INTERVAL_MS } from "./tts-pacing";

export type RedoOutcome = { ok: boolean; message: string };
export type RedoFailure = { index: number; message: string };
export type RedoResult = { done: number[]; failed: RedoFailure[] };

/** The lines a "Redo all" voices again: the ones that already have a take, in script order. */
export function voicedLineIndexes(lines: { index: number }[], recorded: Record<number, unknown>): number[] {
  return lines.map((l) => l.index).filter((i) => Boolean(recorded[i])).sort((a, b) => a - b);
}

/** Gemini TTS (both Gemini providers): request starts at least 60 / 9 s apart, across requests too (#63). */
export const redoGapMs = (provider: VoiceProvider) => (provider === "gemini_tts" || provider === "gemini_tts_rvc" ? TTS_MIN_INTERVAL_MS : 0);

const QUOTA = /\b429\b|quota|RESOURCE_EXHAUSTED|rate.?limit|too many requests/i;
type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };
const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/**
 * Voices `indexes` one at a time with `redo`, starts at least `gapMs` apart. A failed line is recorded and the batch
 * carries on (every line that worked stays done); a quota error stops it, and the lines not tried yet are listed as
 * failed with that reason, so "Retry failed lines" picks them up later without burning more quota now.
 */
export async function runRedoAll(opts: {
  indexes: number[];
  redo: (index: number) => Promise<RedoOutcome>;
  gapMs: number;
  onProgress?: (current: number, total: number, index: number) => void;
  clock?: Clock;
}): Promise<RedoResult> {
  const clock = opts.clock ?? realClock;
  const total = opts.indexes.length;
  const done: number[] = [];
  const failed: RedoFailure[] = [];
  let lastStart = -Infinity;
  for (const [k, index] of opts.indexes.entries()) {
    const wait = lastStart + opts.gapMs - clock.now();
    if (wait > 0) await clock.sleep(wait);
    lastStart = clock.now();
    opts.onProgress?.(k + 1, total, index);
    const r = await opts.redo(index).catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
    if (r.ok) {
      done.push(index);
      continue;
    }
    failed.push({ index, message: r.message });
    if (QUOTA.test(r.message)) {
      for (const rest of opts.indexes.slice(k + 1)) failed.push({ index: rest, message: "Not tried: the voice provider's quota is used up for now." });
      break;
    }
  }
  return { done, failed };
}
