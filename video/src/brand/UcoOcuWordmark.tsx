import "@fontsource/lilita-one/400.css";
import React from "react";

// The "UCO & OCU" wordmark: chunky rounded uppercase (Lilita One), warm cream #FFF8E7 fill, thick #141619 outline,
// an orange #F5A623 outer contour around UCO and a teal #587A7C one around OCU. Every style renders the brand name with this, never as plain text.
// Letter widths are fixed with textLength, so the mark is the same size in every render.

const INK = "#141619";
const CREAM = "#FFF8E7";
const ORANGE = "#F5A623";
const TEAL = "#587A7C";
export const WORDMARK_ASPECT = 300 / 80;

export function UcoOcuWordmark({ height, shadow = true }: { height: number; shadow?: boolean }) {
  const font = { fontFamily: "'Lilita One', 'Arial Black', sans-serif", textAnchor: "middle" as const, strokeLinejoin: "round" as const };
  // Each word is three stacked passes: a wide coloured outer contour, the thick ink outline, then the cream letters.
  const word = (text: string, x: number, y: number, size: number, contour: string | null, length?: number) => {
    const fit = length ? { textLength: length, lengthAdjust: "spacingAndGlyphs" as const } : {};
    return (
      <g key={text}>
        {shadow && (
          <text x={x + 3} y={y + 5} fontSize={size} {...font} {...fit} fill={INK} stroke={INK} strokeWidth={contour ? 22 : 12}>
            {text}
          </text>
        )}
        {contour && (
          <text x={x} y={y} fontSize={size} {...font} {...fit} fill={contour} stroke={contour} strokeWidth={22}>
            {text}
          </text>
        )}
        <text x={x} y={y} fontSize={size} {...font} {...fit} fill={INK} stroke={INK} strokeWidth={10}>
          {text}
        </text>
        <text x={x} y={y} fontSize={size} {...font} {...fit} fill={CREAM}>
          {text}
        </text>
      </g>
    );
  };
  return (
    <svg
      viewBox="0 0 300 80"
      height={height}
      width={height * WORDMARK_ASPECT}
      style={{ overflow: "visible", display: "block", flexShrink: 0 }}
      role="img"
      aria-label="Uco & Ocu"
    >
      {word("UCO", 63, 62, 58, ORANGE, 106)}
      {word("&", 150, 60, 46, null)}
      {word("OCU", 237, 62, 58, TEAL, 106)}
    </svg>
  );
}

const BRAND = /^\s*uco\s*(&|and|dan|x|×)\s*ocu\s*$/i;
export const isBrandName = (text: string | null | undefined) => BRAND.test(text ?? "");

/** Renders `text`, swapping in the wordmark when the text is the brand name. */
export function BrandAware({ text, height, children }: { text: string; height: number; children: React.ReactNode }) {
  return isBrandName(text) ? <UcoOcuWordmark height={height} /> : <>{children}</>;
}
