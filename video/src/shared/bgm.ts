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

/**
 * The music bed as the video plays it, prepared once per render (render.mts): leading silence skipped, the track's
 * quiet sections (an intro, a breakdown) lifted toward its loud ones (dynaudnorm: ~12 s window, up to +20 dB), then
 * normalized to −16 LUFS. A bed with a near-silent first 15 s and a quiet 30-55 s breakdown used to sit inaudible
 * under the dialogue until its drums came in at 0:51; prepared, it reads at an even level from 0:00, so the fixed
 * BGM_UNDER_DIALOGUE gain lands about 20 dB under −14 LUFS speech everywhere.
 */
export const BED_CHAIN = "silenceremove=start_periods=1:start_threshold=-45dB,dynaudnorm=f=400:g=31:p=0.95:m=10:s=12,loudnorm=I=-16:TP=-1.5:LRA=4";
