import type { Beat } from "../beats";
import type { SfxCue } from "./Compositing";

/**
 * Sound-effect timing from the beat list: a whoosh on every cut to a different camera shot, a pop when a
 * topic prop springs in, a ding when an explainer card or callout lands, a record scratch on a shocked
 * close-up, and (styles with a stamp slam) a stamp on the slam frame.
 */
/** Frame (inside a beat) where the kinetic stamp slams in without a recording (kept for the asset checklist). */
export const KINETIC_SLAM = 10;
/** Frame (inside a beat) where its on-screen callout lands: as the voice starts (the outro card: frame 10). */
export const kineticAt = (b: Pick<Beat, "speechStart" | "line">) => (b.line === null ? KINETIC_SLAM : b.speechStart);

/** Frame (inside the beat) of the k-th sound effect the script names for a line: from the moment the voice starts,
 *  6 frames apart (never before the character begins talking). */
export const scriptSfxFrame = (speechStart: number, k: number) => speechStart + k * 6;

export function sfxCuesFor(beats: Beat[], opts: { stampAt?: number } = {}): SfxCue[] {
  const cues: SfxCue[] = [];
  beats.forEach((b, i) => {
    if (i > 0 && beats[i - 1].cameraShot !== b.cameraShot) cues.push({ name: "whoosh", frame: b.startFrame, volume: 0.5 });
    // the pop lands with the prop's spring entrance (timed to its keyword); thought bubbles and outros pop no prop
    if (!b.thought && b.cameraShot !== "cta-stinger" && (b.propImage || b.propTag !== "none" || b.sceneImageUrl)) cues.push({ name: "pop", frame: b.startFrame + b.propEntry, volume: 0.55 });
    if (b.overlay) cues.push({ name: "ding", frame: b.startFrame + b.speechStart + 16, volume: 0.45 });
    // callouts start drawing 10 frames after their prop lands
    else if (b.callouts.length) cues.push({ name: "ding", frame: b.startFrame + b.propEntry + 10, volume: 0.45 });
    if (b.cameraShot === "closeup-punch" && b.emotion === "shocked") cues.push({ name: "record-scratch", frame: b.startFrame, volume: 0.5 });
    // sound effects the script names for this line, as the voice starts
    b.sfx.forEach((name, k) => cues.push({ name, frame: b.startFrame + scriptSfxFrame(b.speechStart, k), volume: 0.6 }));
    // the on-screen callout stamps in as the voice starts (styles with a stamp slam)
    if (opts.stampAt !== undefined && b.kinetic && b.durationInFrames > kineticAt(b)) cues.push({ name: "stamp", frame: b.startFrame + kineticAt(b), volume: 0.7 });
  });
  // the same effect twice within half a second (a script's own "whoosh" on a cut that already whooshes) plays once
  const out: SfxCue[] = [];
  for (const c of cues.sort((a, b) => a.frame - b.frame)) {
    if (out.some((o) => o.name === c.name && Math.abs(o.frame - c.frame) < 15)) continue;
    out.push(c);
  }
  return out;
}
