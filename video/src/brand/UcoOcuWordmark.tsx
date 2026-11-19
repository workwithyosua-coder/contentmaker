import "@fontsource/lilita-one/400.css";
import React from "react";

// The "UCO & OCU" wordmark: chunky rounded uppercase (Lilita One), warm cream fill, thick ink outline, an orange
// plate behind UCO and a teal plate behind OCU. Every style renders the brand name with this, never as plain text.
// Letter widths are fixed with textLength, so the mark is the same size in every render.

const INK = "#141619";
const CREAM = "#FFF8E7";
const ORANGE = "#F5A623";
const TEAL = "#587A7C";
export const WORDMARK_ASPECT = 300 / 80;

export function UcoOcuWordmark({ height, shadow = true }: { height: number; shadow?: boolean }) {
  const letters = {
    fontFamily: "'Lilita One', 'Arial Black', sans-serif",
    fill: CREAM,
    stroke: INK,
    strokeWidth: 9,
    strokeLinejoin: "round" as const,
    paintOrder: "stroke" as const,
    textAnchor: "middle" as const,
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
      {shadow && (
        <g transform="translate(4, 5)" fill={INK}>
          <rect x={4} y={12} width={118} height={60} rx={26} transform="rotate(-3 63 42)" />
          <rect x={178} y={10} width={118} height={60} rx={26} transform="rotate(3 237 40)" />
        </g>
      )}
      <rect x={4} y={12} width={118} height={60} rx={26} fill={ORANGE} stroke={INK} strokeWidth={4} transform="rotate(-3 63 42)" />
      <rect x={178} y={10} width={118} height={60} rx={26} fill={TEAL} stroke={INK} strokeWidth={4} transform="rotate(3 237 40)" />
      <text x={63} y={62} fontSize={56} textLength={100} lengthAdjust="spacingAndGlyphs" {...letters}>
        UCO
      </text>
      <text x={150} y={60} fontSize={50} {...letters} strokeWidth={8}>
        &amp;
      </text>
      <text x={237} y={60} fontSize={56} textLength={100} lengthAdjust="spacingAndGlyphs" {...letters}>
        OCU
      </text>
    </svg>
  );
}

const BRAND = /^\s*uco\s*(&|and|dan|x|×)\s*ocu\s*$/i;
export const isBrandName = (text: string | null | undefined) => BRAND.test(text ?? "");

/** Renders `text`, swapping in the wordmark when the text is the brand name. */
export function BrandAware({ text, height, children }: { text: string; height: number; children: React.ReactNode }) {
  return isBrandName(text) ? <UcoOcuWordmark height={height} /> : <>{children}</>;
}
