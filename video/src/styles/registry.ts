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

// Cue-based styles (from the Uco & Ocu Style Lab reference (PR #28)). The headline is each beat's important message
// (kicker ≤ 2 words, headline ≤ 5 words); both add the line's English subtitle under the cast (never Indonesian). Beat timeline: video/src/beats.ts.
export const EDITORIAL_PAPER_CUTOUT_STYLE = {
  id: "editorial-paper-cutout",
  label: "Koran Kinetik",
  shortDescription: "Editorial paper cut-out: newsprint canvas, highlighter sweeps, red stamps, big cast, 5-word headlines and English subtitles.",
  aspectRatio: "9:16",
  resolution: { width: 1080, height: 1920 },
  fps: 30,
  cues: "important-message",
  palette: {
    canvas: "#F4EFE6",
    ink: "#141619",
    primary: "#D9381E",
    accent: "#FFE600",
    surface: "#FFFFFF",
    ucoBg: "#F5A623",
    ocuBg: "#3A5859",
  },
  editingGrammar: { transitionFrames: 6, transitionType: "paper-slide", pushInScale: [1.0, 1.04], messageMaxWords: 5 },
  visualRules: {
    linework: "Flat paper cut-out collage on warm newsprint (#F4EFE6) with fine halftone dots; characters as white-bordered cut-outs with a hard ink drop shadow.",
    elevation: "Hard offset ink shadows (5px 5px 0 #141619), sharp rectangular paper cards, a yellow highlighter sweep behind headlines and a tilted red stamp.",
    forbiddenEffects: "Flat paper colour only; the only soft effects are the edge vignette and 4% paper grain. No glow, no blur, no Indonesian subtitles (English movie subtitles only), no baked-in text, voices, or music in raw generated video clips.",
  },
  characters: {
    uco: {
      refAsset: "ref-uco.png",
      appearance: "Young man with messy copper-ginger hair, thick black rectangular glasses, mustard-orange sweater over a pale yellow collared shirt, cut out of paper with a white border.",
      framingAndMotion: "Paper cut-out bust that scales up and tilts -2deg when speaking; paper-slide entrance; slow 1.00 to 1.04 push-in per beat.",
    },
    ocu: {
      refAsset: "ref-ocu.png",
      appearance: "Calm young man with grey-blue skin, smooth dark swept-back quiff, thin rectangular glasses, half-lidded eyes, dark teal turtleneck under a slate-teal blazer, cut out of paper with a white border.",
      framingAndMotion: "Paper cut-out bust, upright and deadpan, tilts 1.5deg when speaking; points right toward the Follow button in the closing beat.",
    },
  },
  shotLayouts: ["paper-two-shot"],
} as const;

export const TACTICAL_VECTOR_HUD_STYLE = {
  id: "tactical-vector-hud",
  label: "Diagram Taktis",
  shortDescription: "Vector HUD explainer: dark grid, spring-snap panels, big cast with live voice meters, 5-word headlines and English subtitles.",
  aspectRatio: "9:16",
  resolution: { width: 1080, height: 1920 },
  fps: 30,
  cues: "important-message",
  palette: {
    canvas: "#11161D",
    ink: "#F8FAFC",
    primary: "#1D4ED8",
    accent: "#F59E0B",
    cyan: "#38BDF8",
    surface: "#1E293B",
    danger: "#EF4444",
  },
  editingGrammar: {
    transitionFrames: 8,
    transitionType: "spring-snap",
    springConfig: { mass: 0.7, damping: 14, stiffness: 200 },
    retractFrame: 98,
    messageMaxWords: 5,
  },
  visualRules: {
    linework: "Flat vector HUD on a dark navy grid (#11161D), crisp 2px outlines in blue, amber and cyan, monospace labels.",
    elevation: "Bordered square HUD panels, no shadows; panels spring-snap in and indicator lines retract before each cut.",
    forbiddenEffects: "Soft light only where it reads as HUD light: speaker colour washes, a subtle rim light, the edge vignette and 3.5% grain. No neon bloom, no blur, no Indonesian subtitles (English movie subtitles only), no baked-in text, voices, or music in raw generated video clips.",
  },
  characters: {
    uco: {
      refAsset: "ref-uco.png",
      appearance: "Young man with messy copper-ginger hair, thick black rectangular glasses, burnt-amber sweater over a pale yellow collar, drawn as a flat vector bust inside an amber HUD panel.",
      framingAndMotion: "Framed in an amber-bordered panel labelled UCO with a live voice meter; panel springs in, meter pulses while he talks.",
    },
    ocu: {
      refAsset: "ref-ocu.png",
      appearance: "Calm young man with grey-blue skin, smooth dark swept-back quiff, thin rectangular glasses, navy turtleneck under a deep-blue blazer, drawn as a flat vector bust inside a cyan HUD panel.",
      framingAndMotion: "Framed in a cyan-bordered panel labelled OCU with a live voice meter; steady deadpan, points right toward the Follow target in the closing beat.",
    },
  },
  shotLayouts: ["hud-two-panel"],
} as const;

export type ShotLayout = (typeof UCO_OCU_2D_COMIC_STYLE.shotLayouts)[number];

type CastMember = { readonly refAsset: string; readonly appearance: string; readonly framingAndMotion: string };
export type VideoStylePreset = {
  readonly id: string;
  readonly label: string;
  readonly shortDescription: string;
  readonly aspectRatio: string;
  readonly resolution: { readonly width: number; readonly height: number };
  readonly fps: number;
  /** "important-message": on-screen text is only each beat's kicker + ≤5-word headline (no subtitles). */
  readonly cues?: "important-message";
  readonly palette: Readonly<Record<string, string>>;
  readonly visualRules: { readonly linework: string; readonly elevation: string; readonly forbiddenEffects: string };
  readonly characters: { readonly uco: CastMember; readonly ocu: CastMember };
  readonly shotLayouts: readonly string[];
};

export const VIDEO_STYLES: readonly VideoStylePreset[] = [CLASSIC_STYLE, UCO_OCU_2D_COMIC_STYLE, EDITORIAL_PAPER_CUTOUT_STYLE, TACTICAL_VECTOR_HUD_STYLE];

/** Styles whose on-screen text comes from each line's important_message cue. */
export const usesImportantMessages = (id: string | null | undefined) => styleById(id).cues === "important-message";
export type VideoStyleId = (typeof VIDEO_STYLES)[number]["id"];
export const DEFAULT_STYLE_ID = CLASSIC_STYLE.id;

/** Remotion composition that renders each style (registered in video/src/Root.tsx). */
export const COMPOSITION_FOR: Record<string, string> = {
  [CLASSIC_STYLE.id]: "Episode",
  [UCO_OCU_2D_COMIC_STYLE.id]: "EpisodeComic",
  [EDITORIAL_PAPER_CUTOUT_STYLE.id]: "EpisodeKoran",
  [TACTICAL_VECTOR_HUD_STYLE.id]: "EpisodeTaktis",
};

/** Known style for an id; older saved values ("comic") map to their current id; unknown ids fall back to Classic. */
export function styleById(id: string | null | undefined): VideoStylePreset {
  const normalized = id === "comic" ? UCO_OCU_2D_COMIC_STYLE.id : id;
  return VIDEO_STYLES.find((s) => s.id === normalized) ?? CLASSIC_STYLE;
}
