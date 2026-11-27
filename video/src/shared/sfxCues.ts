import type { Beat } from "../beats";
import type { SfxCue } from "./Compositing";

/**
 * Sound-effect timing from the beat list: a whoosh only on a major visual shift (into a takeover stat card, to or
 * from a two-shot, into the outro; never on ordinary back-and-forth cuts or inner thoughts), a pop when a topic prop
 * springs in, a ding when an explainer card or callout lands, a record scratch on a shocked close-up, and (styles
 * with a stamp slam) a stamp on the slam frame. Every effect sits under the dialogue (SFX_VOLUME).
 */

/** Mix levels: accents under the dialogue, not jolts. */
export const SFX_VOLUME: Record<string, number> = { whoosh: 0.15, pop: 0.24, stamp: 0.26, ding: 0.3, "record-scratch": 0.3 };
const vol = (name: string) => SFX_VOLUME[name] ?? 0.3;

/** A cut worth a whoosh: into a takeover, to or from a two-shot, or into the outro; never into or out of a thought. */
export function majorShift(prev: Pick<Beat, "cameraShot" | "layout" | "thought"> | undefined, b: Pick<Beat, "cameraShot" | "layout" | "thought" | "line">): boolean {
  if (!prev || b.thought || prev.thought) return false;
  if (b.cameraShot === "cta-stinger" || b.line === null) return prev.cameraShot !== "cta-stinger";
  if (b.layout === "takeover" && prev.layout !== "takeover") return true;
  return (prev.cameraShot === "two-shot") !== (b.cameraShot === "two-shot");
}
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
    const shift = majorShift(beats[i - 1], b);
    if (shift) cues.push({ name: "whoosh", frame: b.startFrame, volume: vol("whoosh") });
    // the pop lands with the prop's spring entrance (timed to its keyword); thought bubbles and outros pop no prop
    if (!b.thought && b.cameraShot !== "cta-stinger" && (b.propImage || b.propTag !== "none" || b.sceneImageUrl)) cues.push({ name: "pop", frame: b.startFrame + b.propEntry, volume: vol("pop") });
    if (b.overlay) cues.push({ name: "ding", frame: b.startFrame + b.speechStart + 16, volume: vol("ding") });
    // callouts start drawing 10 frames after their prop lands
    else if (b.callouts.length) cues.push({ name: "ding", frame: b.startFrame + b.propEntry + 10, volume: vol("ding") });
    if (b.cameraShot === "closeup-punch" && b.emotion === "shocked") cues.push({ name: "record-scratch", frame: b.startFrame, volume: vol("record-scratch") });
    // sound effects the script names for this line, as the voice starts
    // (a script's whoosh only where the picture really shifts: never on a plain dialogue cut or a thought)
    b.sfx.filter((name) => name !== "whoosh" || shift).forEach((name, k) => cues.push({ name, frame: b.startFrame + scriptSfxFrame(b.speechStart, k), volume: vol(name) }));
    // the on-screen callout stamps in as the voice starts (styles with a stamp slam)
    if (opts.stampAt !== undefined && b.kinetic && b.durationInFrames > kineticAt(b)) cues.push({ name: "stamp", frame: b.startFrame + kineticAt(b), volume: vol("stamp") });
  });
  // the same effect twice within half a second (a script's own "whoosh" on a cut that already whooshes) plays once
  const out: SfxCue[] = [];
  for (const c of cues.sort((a, b) => a.frame - b.frame)) {
    if (out.some((o) => o.name === c.name && Math.abs(o.frame - c.frame) < 15)) continue;
    out.push(c);
  }
  return out;
}
