import { timeline, type EpisodeLine } from "../types";

// The Comic style is driven by a typed SHOTS array (video/styles/comic.md §1), built from the episode's lines.
export type ShotLayout = "solo-uco" | "solo-ocu" | "split" | "thought";

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

export function buildShots(lines: EpisodeLine[]): Shot[] {
  const { starts, end } = timeline(lines);
  return lines.map((l, i) => {
    const visual = l.visual ?? "";
    const layout: ShotLayout = l.thought_bubble
      ? "thought"
      : /split/i.test(visual) || l.beat === "concession" || l.beat === "button" || (l.beat === "counter" && i > 0)
        ? "split"
        : l.speaker === "uco"
          ? "solo-uco"
          : "solo-ocu";
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
