import type { Beat } from "../beats";
import type { EpisodeLine } from "../types";

/**
 * Koran Kinetik draws "angry" with the master art's own poses until angry sprites in the same style replace the
 * uploaded ones: shocked on a shouted line ("!"), else defensive. The angry delivery keeps its shake and red vignette.
 */
export function koranPoses(beats: Beat[], lines: EpisodeLine[]): Beat[] {
  for (const b of beats) {
    if (b.emotion !== "angry") continue;
    const l = b.line === null ? null : lines[b.line];
    b.emotion = /!/.test(`${l?.text ?? ""} ${l?.subtitle ?? ""}`) ? "shocked" : "defensive";
  }
  return beats;
}
