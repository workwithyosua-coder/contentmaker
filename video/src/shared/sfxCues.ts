import type { Beat } from "../beats";
import { sfxFile } from "../assets";
import type { SfxCue } from "./Compositing";
import { bgmDropOut } from "./bgm";
import { ctaTapFrame } from "./motion";

/**
 * Editorial sound design from the beat list: every effect is tied to something landing on screen, never to a cut.
 *   - a takeover stat card: a whoosh into it and a stamp as it slams (the first beat of a takeover run)
 *   - a NEW prop: a pop on its spring entrance (not the same prop staying on screen)
 *   - impact accents: at most 3 per episode, at least 2 beats apart, on a shocked / angry line or a punchline with a
 *     red callout: a stamp under a callout, else a light pop
 *   - the outro's FOLLOW + → FOLLOWED ✔ flip: a ding (a pop without the file)
 *   - the final (hypocrisy) punchline: a record scratch in the pre-punchline beat drop, ending as the voice lands, so
 *     the music "stops" and the joke hits in silence (that beat takes no other accent)
 * Never on a plain dialogue cut or an inner thought, never a script-named effect, and never a stamp per callout
 * (#58: the callout stamp on every beat was the "chk-tsk" on every line).
 */

/** Mix levels: accents under the dialogue, not jolts. */
export const SFX_VOLUME = { whoosh: 0.16, stamp: 0.26, pop: 0.22, accentStamp: 0.22, accentPop: 0.18, ding: 0.28, scratch: 0.24 } as const;
/** The record scratch's length in frames (public/sfx/record-scratch.mp3, 0.36 s at 30 fps): it ends as the punchline's voice lands. */
export const SCRATCH_FRAMES = 11;
/** The least room (frames of silence between the line before and the punchline's voice) a scratch needs to read cleanly. */
export const SCRATCH_MIN_ROOM = 8;

/**
 * The punchline's record scratch: in the silence between the previous line's last word and the punchline's first,
 * ending as the punchline's voice lands (it may start later than SCRATCH_FRAMES before it when the gap is shorter,
 * never on top of the previous voice). Null without a punchline drop-out or when the gap is under SCRATCH_MIN_ROOM.
 */
export function scratchCue(beats: Beat[]): SfxCue | null {
  const drop = bgmDropOut(beats);
  if (!drop) return null;
  const at = beats.findIndex((b) => b.cameraShot === "cta-stinger") - 1;
  const prev = beats[at - 1];
  const prevVoiceEnd = prev ? prev.startFrame + prev.speechEnd + 1 : 0;
  const start = Math.max(drop.to - SCRATCH_FRAMES, prevVoiceEnd, 0);
  if (drop.to - start < SCRATCH_MIN_ROOM) return null;
  return { name: "record-scratch", frame: start, volume: SFX_VOLUME.scratch };
}
/** Impact accents per episode, and the beats between two of them. */
export const ACCENT_BUDGET = { max: 3, minGap: 3 } as const;

/** Frame (inside a beat) where the kinetic stamp slams in without a recording (kept for the asset checklist). */
export const KINETIC_SLAM = 10;
/** Frame (inside a beat) where its on-screen callout lands: as the voice starts (the outro card: frame 10). */
export const kineticAt = (b: Pick<Beat, "speechStart" | "line">) => (b.line === null ? KINETIC_SLAM : b.speechStart);

/** Frame (inside the beat) of the k-th sound effect the script names for a line: from the moment the voice starts,
 *  6 frames apart (never before the character begins talking). */
export const scriptSfxFrame = (speechStart: number, k: number) => speechStart + k * 6;

/** The prop a beat shows (illustrated PNG, scene image or coded prop), or null. */
const propOf = (b: Pick<Beat, "propImage" | "propTag" | "sceneImageUrl">) => b.propImage ?? b.sceneImageUrl ?? (b.propTag !== "none" ? b.propTag : null);

/** A beat worth an impact accent: a shocked or angry line, or the punchline (button) landing with a red callout. */
const accentWorthy = (b: Beat) => b.emotion === "shocked" || b.angry || (b.beatType === "button" && Boolean(b.kinetic));

export function sfxCuesFor(beats: Beat[], opts: { ding?: boolean; scratch?: boolean } = {}): SfxCue[] {
  const cues: SfxCue[] = [];
  let accents = 0;
  let lastAccent = -Infinity;
  // the punchline's record scratch (only with the file, and only when there's a punchline drop-out: a spoken line
  // right before the outro)
  const scratch = (opts.scratch ?? Boolean(sfxFile("record-scratch"))) ? scratchCue(beats) : null;
  const punchline = scratch ? beats.findIndex((b) => b.cameraShot === "cta-stinger") - 1 : -1;
  if (scratch) cues.push(scratch);
  beats.forEach((b, i) => {
    const prev = beats[i - 1];
    // the outro's button flip
    if (b.cameraShot === "cta-stinger") {
      const ding = opts.ding ?? Boolean(sfxFile("ding"));
      cues.push({ name: ding ? "ding" : "pop", frame: b.startFrame + ctaTapFrame(b.durationInFrames), volume: ding ? SFX_VOLUME.ding : SFX_VOLUME.pop });
      return;
    }
    if (b.thought || b.line === null) return;
    const lands = b.startFrame + kineticAt(b);
    // a takeover stat card: whoosh in, stamp on the slam (once per takeover run)
    const takeover = b.layout === "takeover" && Boolean(b.stat);
    if (takeover && !(prev && prev.layout === "takeover" && prev.stat)) {
      cues.push({ name: "whoosh", frame: Math.max(b.startFrame, lands - 4), volume: SFX_VOLUME.whoosh });
      cues.push({ name: "stamp", frame: lands, volume: SFX_VOLUME.stamp });
    }
    // a new prop pops in with its spring entrance
    const prop = propOf(b);
    const newProp = Boolean(prop) && !takeover && (!prev || prev.thought || propOf(prev) !== prop);
    if (newProp) cues.push({ name: "pop", frame: b.startFrame + b.propEntry, volume: SFX_VOLUME.pop });
    // impact accents, rationed and spaced
    if (i !== punchline && !takeover && !newProp && accentWorthy(b) && accents < ACCENT_BUDGET.max && i - lastAccent >= ACCENT_BUDGET.minGap) {
      cues.push(b.kinetic ? { name: "stamp", frame: lands, volume: SFX_VOLUME.accentStamp } : { name: "pop", frame: lands, volume: SFX_VOLUME.accentPop });
      accents++;
      lastAccent = i;
    }
  });
  return cues.sort((a, b) => a.frame - b.frame);
}
