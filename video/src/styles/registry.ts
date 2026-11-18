// Video style registry: the single list of selectable styles. Read by the app (picker, preview, shot prompts) and by
// the renderer (composition per style). Pure data, no React, so both Next.js and Remotion can import it.

export const CLASSIC_STYLE = {
  id: "classic",
  label: "Classic",
  shortDescription: "The original look: art-bible characters, orange burst and teal spotlight stages, rounded captions.",
  aspectRatio: "9:16",
  resolution: { width: 1080, height: 1920 },
  fps: 30,
  palette: {
    ink: "#0E0E12",
    ucoOrange: "#E85D04",
    ocuTeal: "#2A6F7B",
    accentYellow: "#FFD60A",
    paperWhite: "#F8F9FA",
    mutedSlate: "#3A5A78",
  },
  visualRules: {
    linework: "Expressive 2D hand-drawn comic cartoon, bold slightly irregular black ink outlines with Ben-Day halftone shading.",
    elevation: "Comic impact bursts, jagged speech-burst caption cards with heavy black drop shadows.",
    forbiddenEffects: "No baked-in text, voices, or music in raw generated video clips.",
  },
  characters: {
    uco: {
      refAsset: "ref-uco.png",
      appearance: "High-energy young Indonesian man in his 20s with wild jagged spiky dark hair, oversized angular rectangular glasses and a burnt-orange collared shirt.",
      framingAndMotion: "Fast overshoot entrances, screen shake when yelling, forward-leaning posture.",
    },
    ocu: {
      refAsset: "ref-ocu.png",
      appearance: "Slouched deadpan young Indonesian man in his 20s with messy flat hair, massive round glasses, half-lidded eyes and a grey t-shirt.",
      framingAndMotion: "Slow linear eases, long deadpan holds, holding an iced drink.",
    },
  },
  shotLayouts: ["uco-solo-orange", "ocu-solo-teal", "split-screen-jagged-yellow", "two-shot-debate", "thought-dimmed-charcoal"],
} as const;

export const UCO_OCU_2D_COMIC_STYLE = {
  id: "uco-ocu-2d-comic",
  label: "Uco & Ocu: 2D Vertical Comic",
  shortDescription: "9:16 bold-ink cel-shaded comic banter with Dutch tilts, split-screen debates, and Remotion overlays.",
  aspectRatio: "9:16",
  resolution: { width: 1080, height: 1920 },
  fps: 30,
  palette: {
    ink: "#141619", // Bold 3px outlines, hard offset shadows, dimmed thought rooms
    ucoOrange: "#F5A623", // Uco solo background, energy bursts, sweater
    ocuTeal: "#3A5859", // Ocu solo background, turtleneck, blazer tones
    accentYellow: "#FFE600", // Jagged split-screen divider, active highlights, focus rings
    paperWhite: "#F8F6F0", // On-screen comic banners, speech/thought bubbles
    mutedSlate: "#A3B1BC", // Secondary metadata and inactive timeline tracks
  },
  visualRules: {
    linework: "2D hand-drawn comic cartoon style, bold 3px solid #141619 black ink outlines, flat cel shading, soft halftone dots.",
    elevation:
      "Hard offset ink shadows (4px 4px 0 #141619) with sharp 0px rectangular corners on panels and banners; circular 9999px radius only on corner cutaway cameo bubbles.",
    forbiddenEffects: "No soft gradients, no glassmorphism blur, no neon glow, no baked-in text, voices, or music in raw generated video clips.",
  },
  characters: {
    uco: {
      refAsset: "ref-uco.png",
      appearance: "Young man with messy copper-ginger hair, thick black rectangular glasses, mustard-orange sweater over a pale yellow collared shirt.",
      framingAndMotion:
        "Tight close-up with -5deg Dutch tilt, pulsing yellow speed lines, cartoon sweat drops, and an overhead cartoon anger thermometer that fills with red and puffs white steam at peak frustration.",
    },
    ocu: {
      refAsset: "ref-ocu.png",
      appearance:
        "Calm young man with grey-blue skin, smooth dark swept-back quiff, thin rectangular glasses, half-lidded eyes, dark teal turtleneck under a grey-blue blazer.",
      framingAndMotion: "Steady upright framing, arms crossed or slow prop lifts, small deadpan mouth movements, subtle knowing smirk, slow camera push-in.",
    },
  },
  shotLayouts: ["uco-solo-orange", "ocu-solo-teal", "split-screen-jagged-yellow", "two-shot-debate", "thought-dimmed-charcoal"],
} as const;

export type ShotLayout = (typeof UCO_OCU_2D_COMIC_STYLE.shotLayouts)[number];

type Widen<T> = T extends string ? string : T extends readonly (infer U)[] ? readonly Widen<U>[] : { readonly [K in keyof T]: Widen<T[K]> };
export type VideoStylePreset = Widen<typeof UCO_OCU_2D_COMIC_STYLE>;

export const VIDEO_STYLES: readonly VideoStylePreset[] = [CLASSIC_STYLE, UCO_OCU_2D_COMIC_STYLE];
export type VideoStyleId = (typeof VIDEO_STYLES)[number]["id"];
export const DEFAULT_STYLE_ID = CLASSIC_STYLE.id;

/** Remotion composition that renders each style (registered in video/src/Root.tsx). */
export const COMPOSITION_FOR: Record<string, string> = {
  [CLASSIC_STYLE.id]: "Episode",
  [UCO_OCU_2D_COMIC_STYLE.id]: "EpisodeComic",
};

/** Known style for an id; older saved values ("comic") map to their current id; unknown ids fall back to Classic. */
export function styleById(id: string | null | undefined): VideoStylePreset {
  const normalized = id === "comic" ? UCO_OCU_2D_COMIC_STYLE.id : id;
  return VIDEO_STYLES.find((s) => s.id === normalized) ?? CLASSIC_STYLE;
}
