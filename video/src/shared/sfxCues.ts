import type { Beat } from "../beats";
import type { SfxCue } from "./Compositing";

/**
 * Sound-effect timing from the beat list: a whoosh on every cut to a different camera shot, a pop when a
 * topic prop springs in, a ding when an explainer card or callout lands, a record scratch on a shocked
 * close-up, and (styles with a stamp slam) a stamp on the slam frame.
 */
/** Frame (inside a beat) where the kinetic stamp slams in. */
export const KINETIC_SLAM = 10;

export function sfxCuesFor(beats: Beat[], opts: { stampAt?: number } = {}): SfxCue[] {
  const cues: SfxCue[] = [];
  beats.forEach((b, i) => {
    if (i > 0 && beats[i - 1].cameraShot !== b.cameraShot) cues.push({ name: "whoosh", frame: b.startFrame, volume: 0.5 });
    // the pop lands with the prop's spring entrance (timed to its keyword); thought bubbles and outros pop no prop
    if (!b.thought && b.cameraShot !== "cta-stinger" && (b.propImage || b.propTag !== "none" || b.sceneImageUrl)) cues.push({ name: "pop", frame: b.startFrame + b.propEntry, volume: 0.55 });
    if (b.overlay) cues.push({ name: "ding", frame: b.startFrame + 16, volume: 0.45 });
    // callouts start drawing 10 frames after their prop lands
    else if (b.callouts.length) cues.push({ name: "ding", frame: b.startFrame + b.propEntry + 10, volume: 0.45 });
    if (b.cameraShot === "closeup-punch" && b.emotion === "shocked") cues.push({ name: "record-scratch", frame: b.startFrame, volume: 0.5 });
    // sound effects the script names for this line, as the line starts
    b.sfx.forEach((name, k) => cues.push({ name, frame: b.startFrame + 2 + k * 6, volume: 0.6 }));
    if (opts.stampAt !== undefined && b.kinetic && b.durationInFrames > opts.stampAt) cues.push({ name: "stamp", frame: b.startFrame + opts.stampAt, volume: 0.7 });
  });
  // the same effect twice within half a second (a script's own "whoosh" on a cut that already whooshes) plays once
  const out: SfxCue[] = [];
  for (const c of cues.sort((a, b) => a.frame - b.frame)) {
    if (out.some((o) => o.name === c.name && Math.abs(o.frame - c.frame) < 15)) continue;
    out.push(c);
  }
  return out;
}
