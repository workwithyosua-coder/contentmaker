import type { Beat } from "../beats";
import type { EpisodeLine } from "../types";

/** The music bed's level while someone talks (≈ −18 dB): heard under the dialogue, never fighting it. */
export const BGM_UNDER_DIALOGUE = 0.12;

/**
 * The music bed's gain on a frame: the direction's bed level between lines and on the end card, BGM_UNDER_DIALOGUE
 * while someone talks, and `thoughtDuck` of that under (thought) lines (0 with "BGM off on thought"). Before this the
 * bed dropped to a third of 20 % (0.07, ≈ −23 dB) under every word, which under −14 LUFS dialogue read as silence.
 */
export function bgmLevel(beats: Beat[], lines: EpisodeLine[], volume: number, thoughtDuck: number, f: number): number {
  const b = beats.find((x) => f >= x.startFrame && f < x.startFrame + x.durationInFrames);
  if (!b || b.line === null) return volume; // end card: full bed
  const l = lines[b.line];
  const talking = (l.envelope?.[f - b.startFrame] ?? 0) > 0.08;
  const bed = talking ? Math.min(volume, BGM_UNDER_DIALOGUE) : volume;
  return bed * (b.thought ? thoughtDuck : 1);
}
