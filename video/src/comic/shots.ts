import { timeline, type EpisodeLine } from "../types";

import type { ShotLayout } from "../styles/registry";

// The 2D Vertical Comic style is driven by a typed SHOTS array (video/styles/comic.md §1), built from the episode's lines.
// Layout names come from the style preset (UCO_OCU_2D_COMIC_STYLE.shotLayouts).
export type { ShotLayout };

export type Shot = {
  id: string;
  beat: string;
  speaker: "uco" | "ocu";
  startFrame: number;
  durationInFrames: number;
  layout: ShotLayout;
  bannerText: string | null;
  dialogueId: string;
  dialogueEn: string;
  sfx: string | null;
  /** index into the episode lines (audio, lip-sync envelope, expression) */
  line: number;
};

const SFX: [RegExp, string][] = [
  [/slap|whack|smack|swat/i, "WHACK!"],
  [/explo|meledak|pop/i, "BOOM!"],
  [/slurp|sip/i, "SLURP"],
  [/bell|ding/i, "DING!"],
  [/receipt|struk|unroll/i, "SRRRT"],
];

type LayoutInput = Pick<EpisodeLine, "speaker" | "beat" | "thought_bubble"> & { visual?: string | null };

/** Which preset shot layout a script line gets. Shared by the Remotion composition and the shot-prompt generator. */
export function layoutFor(l: LayoutInput, i: number): ShotLayout {
  const visual = l.visual ?? "";
  if (l.thought_bubble) return "thought-dimmed-charcoal";
  if (l.beat === "button" || /two.?shot|both|together/i.test(visual)) return "two-shot-debate";
  if (/split/i.test(visual) || l.beat === "concession" || (l.beat === "counter" && i > 0)) return "split-screen-jagged-yellow";
  return l.speaker === "uco" ? "uco-solo-orange" : "ocu-solo-teal";
}

export function buildShots(lines: EpisodeLine[]): Shot[] {
  const { starts, end } = timeline(lines);
  return lines.map((l, i) => {
    const visual = l.visual ?? "";
    const layout = layoutFor(l, i);
    return {
      id: `s${String(i + 1).padStart(2, "0")}`,
      beat: l.beat,
      speaker: l.speaker,
      startFrame: starts[i],
      durationInFrames: (starts[i + 1] ?? end) - starts[i],
      layout,
      bannerText: l.on_screen_text ? l.on_screen_text.toUpperCase() : null,
      dialogueId: l.text,
      dialogueEn: l.subtitle,
      sfx: SFX.find(([re]) => re.test(visual))?.[1] ?? null,
      line: i,
    };
  });
}
