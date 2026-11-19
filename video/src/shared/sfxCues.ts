import type { Beat } from "../beats";
import type { SfxCue } from "./Compositing";

/**
 * Sound-effect timing from the beat list: a whoosh on every cut to a different camera shot, a pop when a solo
 * shot's topic prop springs in, a ding when an explainer card or callout lands, a record scratch on a shocked
 * close-up, and (styles with a stamp slam) a stamp on the slam frame.
 */
/** Frame (inside a beat) where the kinetic stamp slams in. */
export const KINETIC_SLAM = 10;

export function sfxCuesFor(beats: Beat[], opts: { stampAt?: number } = {}): SfxCue[] {
  const cues: SfxCue[] = [];
  beats.forEach((b, i) => {
    if (i > 0 && beats[i - 1].cameraShot !== b.cameraShot) cues.push({ name: "whoosh", frame: b.startFrame, volume: 0.5 });
    const solo = b.cameraShot === "solo-uco" || b.cameraShot === "solo-ocu";
    if (solo && (b.propImage || b.propTag !== "none" || b.sceneImageUrl)) cues.push({ name: "pop", frame: b.startFrame + 6, volume: 0.55 });
    if (b.overlay || b.callouts.length) cues.push({ name: "ding", frame: b.startFrame + 16, volume: 0.45 });
    if (b.cameraShot === "closeup-punch" && b.emotion === "shocked") cues.push({ name: "record-scratch", frame: b.startFrame, volume: 0.5 });
    if (opts.stampAt !== undefined && b.kinetic && b.durationInFrames > opts.stampAt) cues.push({ name: "stamp", frame: b.startFrame + opts.stampAt, volume: 0.7 });
  });
  return cues;
}
