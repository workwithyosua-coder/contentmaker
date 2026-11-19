import { layoutFor } from "../../video/src/comic/shots";
import { styleById, type ShotLayout, type VideoStylePreset } from "../../video/src/styles/registry";

// Shot-by-shot prompts for an image-to-video model (Gemini / Veo), built from the script and the selected style preset.
// Each prompt stands alone (video models don't remember the previous clip), describes picture only and asks for a
// silent clip: voices, captions, banners and SFX are added by the app afterwards.

export type PromptLine = {
  index: number;
  speaker: "uco" | "ocu";
  beat: string;
  expression: string;
  subtitle: string;
  visual?: string | null;
  thought_bubble?: boolean;
};

export type ShotPrompt = { index: number; layout: ShotLayout; refAsset: string; seconds: number; prompt: string };

const LAYOUT_TEXT: Record<ShotLayout, (s: VideoStylePreset, who: "uco" | "ocu") => string> = {
  "uco-solo-orange": (s) => `Solo shot of Uco on a flat ${s.palette.ucoOrange} orange background with soft halftone dots.`,
  "ocu-solo-teal": (s) => `Solo shot of Ocu on a flat ${s.palette.ocuTeal} teal background with soft halftone dots.`,
  "split-screen-jagged-yellow": (s, who) =>
    `Vertical split screen: Uco on the left over flat ${s.palette.ucoOrange} orange, Ocu on the right over flat ${s.palette.ocuTeal} teal, divided by a jagged zig-zag ${s.palette.accentYellow} yellow lightning line. ${who === "uco" ? "Uco" : "Ocu"} is speaking; the other side is slightly dimmed and listening.`,
  "two-shot-debate": (s) =>
    `Two-shot: Uco and Ocu side by side in one shared room, facing each other across a small table, plain ${s.palette.paperWhite} wall with soft halftone dots, both fully lit.`,
  "thought-dimmed-charcoal": (s, who) =>
    `Inner-thought shot: the room dimmed to flat ${s.palette.ink} charcoal, both characters shown as calm silhouettes with a thin rim light, ${who === "uco" ? "Uco" : "Ocu"} slightly brighter, a blank empty thought cloud above his head.`,
};

const MOOD: Record<string, string> = {
  angry: "visibly angry, brows down, jaw tight",
  furious: "furious, red face, fists up",
  excited: "excited, eyes wide, leaning in",
  shocked: "shocked, mouth open, eyes huge",
  smug: "smug half-smile",
  thinking: "thinking, hand on chin",
  deadpan: "deadpan, half-lidded eyes, no smile",
  calm: "calm and relaxed",
  worried: "worried, brows raised",
  neutral: "neutral",
};

// Cue-based styles (Koran Kinetik, Diagram Taktis) keep both characters on one canvas; the clip only needs the
// cast acting on that canvas, the app adds the cards, headlines and diagrams.
const CUE_LAYOUT: Record<ShotLayout, (s: VideoStylePreset, who: "uco" | "ocu") => string> = {
  "uco-solo-orange": (s) => `Uco centred on the flat ${s.palette.canvas} canvas, Ocu out of frame.`,
  "ocu-solo-teal": (s) => `Ocu centred on the flat ${s.palette.canvas} canvas, Uco out of frame.`,
  "split-screen-jagged-yellow": (s, who) => `Uco on the left and Ocu on the right of the flat ${s.palette.canvas} canvas; ${who === "uco" ? "Uco" : "Ocu"} is speaking, the other listens.`,
  "two-shot-debate": (s) => `Uco and Ocu side by side on the flat ${s.palette.canvas} canvas, both lit, facing each other.`,
  "thought-dimmed-charcoal": (s, who) => `Uco and Ocu side by side on the flat ${s.palette.canvas} canvas, ${who === "uco" ? "Uco" : "Ocu"} lost in thought, lips closed.`,
};

export function shotPrompts(lines: PromptLine[], styleId: string): ShotPrompt[] {
  const s = styleById(styleId);
  const layoutText = s.cues === "important-message" ? CUE_LAYOUT : LAYOUT_TEXT;
  return lines.map((l, i) => {
    const layout = layoutFor(l, i);
    const both = layout === "split-screen-jagged-yellow" || layout === "two-shot-debate" || layout === "thought-dimmed-charcoal";
    const who = s.characters[l.speaker];
    const words = l.subtitle.split(/\s+/).filter(Boolean).length;
    const seconds = Math.min(8, Math.max(4, Math.round(words / 2.6) + 1));
    const prompt = [
      `${s.aspectRatio} vertical video, ${s.resolution.width}x${s.resolution.height}, ${seconds} seconds, ${s.fps} fps.`,
      `Style: ${s.visualRules.linework} ${s.visualRules.elevation}`,
      layoutText[layout](s, l.speaker),
      both
        ? `Uco: ${s.characters.uco.appearance} Ocu: ${s.characters.ocu.appearance}`
        : `${l.speaker === "uco" ? "Uco" : "Ocu"}: ${who.appearance}`,
      layout === "thought-dimmed-charcoal" ? "" : `Camera and motion: ${who.framingAndMotion}`,
      `Acting: ${l.speaker === "uco" ? "Uco" : "Ocu"} is ${MOOD[l.expression] ?? l.expression}${layout === "thought-dimmed-charcoal" ? ", lips closed" : ", mouth moving as if talking"}.${l.visual ? ` Action: ${l.visual}.` : ""}`,
      `Match the characters exactly to the attached reference image (${both ? "ref-both.png" : who.refAsset}).`,
      `${s.visualRules.forbiddenEffects} No voices, no music, no text, no letters, no logos, no subtitles.`,
    ]
      .filter(Boolean)
      .join("\n");
    return { index: l.index, layout, refAsset: both ? "ref-both.png" : who.refAsset, seconds, prompt };
  });
}
