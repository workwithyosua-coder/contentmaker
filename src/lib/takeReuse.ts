// Re-using recorded / AI takes across script versions. A new version whose line is word for word the same as a line
// of the previous version (same speaker, same Indonesian text) keeps that line's selected take, so re-pasting a
// script to change its cues, poses or props never needs the line voiced again (and never calls ElevenLabs).
// Pure: no database, no network, no AI.

export type TakeLine = { speaker: string; text: string };

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * For each line of `next`, the index of the identical line in `prev` whose take it can reuse, or -1. A line keeps
 * the take at its own position when that line is unchanged; otherwise the first unused identical line is used
 * (lines moved around keep their takes too). Each previous take is reused once.
 */
export function reusableTakes(prev: TakeLine[], next: TakeLine[], recorded: Set<number>): number[] {
  const used = new Set<number>();
  const same = (a: TakeLine, b: TakeLine) => a.speaker === b.speaker && norm(a.text) === norm(b.text);
  const out = next.map(() => -1);
  next.forEach((l, i) => {
    if (prev[i] && recorded.has(i) && same(prev[i], l)) {
      out[i] = i;
      used.add(i);
    }
  });
  next.forEach((l, i) => {
    if (out[i] >= 0) return;
    const j = prev.findIndex((p, k) => !used.has(k) && recorded.has(k) && same(p, l));
    if (j >= 0) {
      out[i] = j;
      used.add(j);
    }
  });
  return out;
}
