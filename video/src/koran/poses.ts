import type { Beat } from "../beats";
import type { EpisodeLine } from "../types";

/**
 * Koran Kinetik draws "angry" with the master art's own poses until angry sprites in the same style replace the
 * uploaded ones: shocked on a shouted line ("!"), else defensive. The angry delivery keeps its shake and red vignette.
 */
export function koranPoses(beats: Beat[], lines: EpisodeLine[]): Beat[] {
  for (const b of beats) {
    const l = b.line === null ? null : lines[b.line];
    const alias = /!/.test(`${l?.text ?? ""} ${l?.subtitle ?? ""}`) ? "shocked" : "defensive";
    if (b.emotion === "angry") b.emotion = alias;
    if (b.listenerPose === "angry") b.listenerPose = "defensive";
  }
  return beats;
}
