// Illustrated PNG props (public/props/{name}.png): which script words call each one up, and where its parts sit for the
// callout labels. Anchors are fractions of the PNG (0..1 from the top-left), measured on the processed files.
// Shared by the video (beats.ts picks the prop) and the app (the pre-render asset checklist).

export type PropPart = { id: string; label: string; x: number; y: number; rx: RegExp };
/** `aspect` is the PNG's width / height (for mapping part anchors onto the drawn image). */
export type PngProp = { name: string; aspect: number; rx: RegExp; parts: PropPart[] };

const AYAM = { id: "ayam", label: "AYAM SUWIR", rx: /\b(ayam|suwir|chicken)\b/i };
const BUBUR = { id: "bubur", label: "BUBUR", rx: /\b(bubur|porridge|congee)\b/i };
const DAUN = { id: "daun-bawang", label: "DAUN BAWANG", rx: /\b(daun bawang|scallions?|spring onions?)\b/i };

// Order matters: the first match wins, so the specific bowls come before the plain one.
export const PNG_PROPS: PngProp[] = [
  {
    name: "nasi-padang-blender",
    aspect: 417 / 900,
    rx: /\b(blender|diblender|blend(ed|ing)?|jus nasi padang|nasi padang (di)?jus)\b/i,
    parts: [
      { id: "rendang", label: "RENDANG", x: 0.408, y: 0.511, rx: /\b(rendang|daging|beef)\b/i },
      { id: "cabai", label: "CABAI HIJAU", x: 0.516, y: 0.572, rx: /\b(cabai|cabe|lado|chili|chilli|sambal)\b/i },
      { id: "nasi", label: "NASI", x: 0.264, y: 0.4, rx: /\b(nasi|rice)\b/i },
      { id: "sedotan", label: "SEDOTAN", x: 0.48, y: 0.111, rx: /\b(sedotan|straw|sedot|minum|drink)\b/i },
    ],
  },
  {
    name: "bubur-kerupuk",
    aspect: 900 / 814,
    rx: /\b(kerupuk|krupuk|crackers?)\b/i,
    parts: [
      { id: "kerupuk", label: "KERUPUK", x: 0.8, y: 0.283, rx: /\b(kerupuk|krupuk|crackers?)\b/i },
      { ...BUBUR, x: 0.333, y: 0.553 },
      { ...DAUN, x: 0.533, y: 0.393 },
      { ...AYAM, x: 0.533, y: 0.504 },
    ],
  },
  {
    name: "bubur-mixed",
    aspect: 900 / 726,
    // stirred, but not "nggak diaduk" / "not stirred" (those are the unmixed bowl)
    rx: /(?<!\b(nggak|gak|ga|tidak|tanpa|jangan|belum|no|not|don't|never|un)[ -]?)\b(diaduk|diaduk-aduk|aduk|ngaduk|mixed|stirred|stir)\b/i,
    parts: [
      { id: "bubur", label: "BUBUR DIADUK", x: 0.5, y: 0.41, rx: /\b(bubur|porridge|congee|diaduk|aduk|mixed|stirred)\b/i },
      { id: "sambal", label: "SAMBAL", x: 0.27, y: 0.47, rx: /\b(sambal|cabai|cabe|chili|chilli)\b/i },
    ],
  },
  {
    name: "bubur-unmixed",
    aspect: 900 / 748,
    rx: /\b(bubur|porridge|congee|(nggak|gak|ga|tidak|tanpa) diaduk|tim (nggak|gak|ga) aduk|unmixed|not stirred|cakwe|cakue)\b/i,
    parts: [
      { ...AYAM, x: 0.256, y: 0.428 },
      { id: "cakwe", label: "CAKWE", x: 0.689, y: 0.241, rx: /\b(cakwe|cakue|fried dough|youtiao)\b/i },
      { ...BUBUR, x: 0.367, y: 0.668 },
      { ...DAUN, x: 0.511, y: 0.374 },
      { id: "bawang-goreng", label: "BAWANG GORENG", x: 0.644, y: 0.535, rx: /\b(bawang goreng|fried shallots?)\b/i },
      { id: "kuah", label: "KUAH KUNING", x: 0.844, y: 0.561, rx: /\b(kuah|kaldu|broth|kuning)\b/i },
    ],
  },
];

export const pngPropByName = (name: string) => PNG_PROPS.find((p) => p.name === name) ?? null;

/** Prop names are kebab-case file names (public/props/{name}.png). */
export const isPropName = (v: string | null | undefined): v is string => Boolean(v && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v));
