// Comic style tokens (video/styles/comic.md). Strict palette; flat colour only.
export const C = {
  ink: "#141619",
  uco: "#F5A623",
  ocu: "#3A5859",
  bolt: "#FFE600",
  paper: "#F8F6F0",
  muted: "#A3B1BC",
  // character fills (badge colours; used only inside the character drawings)
  ucoSkin: "#F2B98C",
  ucoHair: "#C8642B",
  ucoHairDark: "#9A4419",
  ucoSweater: "#D9952B",
  ucoCollar: "#F7E3A1",
  ocuSkin: "#8FAEB4",
  ocuHair: "#2F4248",
  ocuTurtle: "#2F4C4E",
  ocuBlazer: "#6E8C93",
  ocuBlazerDark: "#58737A",
  mouth: "#5A1E1E",
  tongue: "#D96A63",
  steam: "#F8F6F0",
  red: "#D7322B",
} as const;

/** Every outline is this many screen pixels, whatever the drawing's scale (vector-effect: non-scaling-stroke). */
export const INK_PX = 3;
export const SHADOW = `4px 4px 0 ${C.ink}`;
export const HEAVY = "Montserrat, 'Arial Black', sans-serif"; // geometric sans, weight 900
export const MONO = "'JetBrains Mono', ui-monospace, monospace"; // only frame numbers, timestamps, code

export const halftone = (opacity = 0.18, size = 14): React.CSSProperties => ({
  backgroundImage: `radial-gradient(rgba(20,22,25,${opacity}) 1.5px, transparent 1.5px)`,
  backgroundSize: `${size}px ${size}px`,
});
