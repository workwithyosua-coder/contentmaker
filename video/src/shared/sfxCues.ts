import type { Beat } from "../beats";
import type { SfxCue } from "./Compositing";

/**
 * Sound-effect timing from the beat list: a whoosh on every cut to a different camera shot, a pop when a solo
 * shot's topic prop springs in, and (styles with a stamp slam) a stamp on the slam frame.
 */
export function sfxCuesFor(beats: Beat[], opts: { stampAt?: number } = {}): SfxCue[] {
  const cues: SfxCue[] = [];
  beats.forEach((b, i) => {
    if (i > 0 && beats[i - 1].cameraShot !== b.cameraShot) cues.push({ name: "whoosh", frame: b.startFrame, volume: 0.5 });
    if (b.cameraShot === "solo-uco" || b.cameraShot === "solo-ocu") cues.push({ name: "pop", frame: b.startFrame + 6, volume: 0.55 });
    if (opts.stampAt !== undefined && b.importantMessage.stamp && b.durationInFrames > opts.stampAt) cues.push({ name: "stamp", frame: b.startFrame + opts.stampAt, volume: 0.7 });
  });
  return cues;
}
