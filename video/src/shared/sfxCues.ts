import type { Beat } from "../beats";
import type { SfxCue } from "./Compositing";

/**
 * Sound effects from the beat list. Only two, both tied to something appearing on screen:
 *   - a stamp when a takeover stat card lands (the first beat of a takeover with a stat)
 *   - a pop when a NEW prop springs in (a different prop from the previous beat's)
 * Nothing else: no transition sound on cuts, no stamp per callout, no ding per card, no script-named effects, and
 * never anything on an inner-thought beat or the outro. (Until this, the red callout stamp played stamp.mp3 on every
 * beat with a callout, which the Show Bible's 75 % visual rule puts on nearly every line.)
 */

/** Mix levels: accents under the dialogue, not jolts. */
export const SFX_VOLUME: Record<string, number> = { stamp: 0.22, pop: 0.2 };

/** Frame (inside a beat) where the kinetic stamp slams in without a recording (kept for the asset checklist). */
export const KINETIC_SLAM = 10;
/** Frame (inside a beat) where its on-screen callout lands: as the voice starts (the outro card: frame 10). */
export const kineticAt = (b: Pick<Beat, "speechStart" | "line">) => (b.line === null ? KINETIC_SLAM : b.speechStart);

/** Frame (inside the beat) of the k-th sound effect the script names for a line: from the moment the voice starts,
 *  6 frames apart (never before the character begins talking). */
export const scriptSfxFrame = (speechStart: number, k: number) => speechStart + k * 6;

/** The prop a beat shows (illustrated PNG, scene image or coded prop), or null. */
const propOf = (b: Pick<Beat, "propImage" | "propTag" | "sceneImageUrl">) => b.propImage ?? b.sceneImageUrl ?? (b.propTag !== "none" ? b.propTag : null);

export function sfxCuesFor(beats: Beat[]): SfxCue[] {
  const cues: SfxCue[] = [];
  beats.forEach((b, i) => {
    if (b.thought || b.cameraShot === "cta-stinger" || b.line === null) return;
    const prev = beats[i - 1];
    // the stat card slams in as the voice starts, once per takeover (not again on a following takeover beat)
    if (b.layout === "takeover" && b.stat && !(prev && prev.layout === "takeover" && prev.stat)) cues.push({ name: "stamp", frame: b.startFrame + kineticAt(b), volume: SFX_VOLUME.stamp });
    // the pop lands with the prop's spring entrance, only when the prop is new on screen
    const prop = propOf(b);
    if (prop && !(b.layout === "takeover" && b.stat) && (!prev || prev.thought || propOf(prev) !== prop)) cues.push({ name: "pop", frame: b.startFrame + b.propEntry, volume: SFX_VOLUME.pop });
  });
  return cues.sort((a, b) => a.frame - b.frame);
}
