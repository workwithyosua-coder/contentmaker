// Global Studio Assets: character sprites and default audio uploaded once from a phone (Accounts → Studio Assets) and
// reused by every episode. They live in the public Supabase Storage bucket `studio-assets` at fixed keys; nothing is
// committed to the repo. Pure code (no DOM, no Node, no AI): shared by the uploader, the server and the unit tests.
//
//   sprites/{uco|ocu}-angry-{closed|open}.png         the processed transparent PNG the video uses
//   sfx/bgm-urgent.mp3                                 the urgent background track (stored under this key as picked)
//   originals/{slot}.{cut|keep}.{jpg|png|webp|…}       the picked photo, kept so "Remove white background" can be
//                                                      switched later; cut / keep records the switch's position
// Own-voice models (RVC) are private: they'd let anyone clone the voice, so they live in the private `recordings`
// bucket at studio-assets/voices/{uco|ocu}-voice.{pth|index}, read only by the server and the render worker.

export const STUDIO_BUCKET = "studio-assets";

export type StudioSlotKind = "sprite" | "audio" | "model";
export type StudioSlot = {
  key: string;
  kind: StudioSlotKind;
  /** object path inside the bucket */
  path: string;
  label: string;
  /** sprites: whose pose and which mouth frame */
  who?: "uco" | "ocu";
  frame?: "closed" | "open";
  emotion?: string;
  group: string;
  /** model slots: the only file extension accepted (".pth" or ".index") */
  ext?: ".pth" | ".index";
  /** "private": the private recordings bucket (models); else the public studio-assets bucket */
  bucket?: "private";
};

export const RVC_GROUP = "Own-Voice Models (RVC)";
export const RVC_HELP = "Upload trained RVC voice models once. Used automatically by the Own-Voice render worker.";

export const STUDIO_SLOTS: readonly StudioSlot[] = [
  { key: "uco-angry-closed", kind: "sprite", path: "sprites/uco-angry-closed.png", label: "Mouth closed", who: "uco", frame: "closed", emotion: "angry", group: "Uco (Angry)" },
  { key: "uco-angry-open", kind: "sprite", path: "sprites/uco-angry-open.png", label: "Mouth open", who: "uco", frame: "open", emotion: "angry", group: "Uco (Angry)" },
  { key: "ocu-angry-closed", kind: "sprite", path: "sprites/ocu-angry-closed.png", label: "Mouth closed", who: "ocu", frame: "closed", emotion: "angry", group: "Ocu (Angry)" },
  { key: "ocu-angry-open", kind: "sprite", path: "sprites/ocu-angry-open.png", label: "Mouth open", who: "ocu", frame: "open", emotion: "angry", group: "Ocu (Angry)" },
  { key: "bgm-urgent", kind: "audio", path: "sfx/bgm-urgent.mp3", label: "bgm-urgent.mp3", group: "Urgent BGM" },
  { key: "uco-voice-pth", kind: "model", path: "studio-assets/voices/uco-voice.pth", label: "Uco model (.pth)", who: "uco", ext: ".pth", bucket: "private", group: RVC_GROUP },
  { key: "uco-voice-index", kind: "model", path: "studio-assets/voices/uco-voice.index", label: "Uco index (.index)", who: "uco", ext: ".index", bucket: "private", group: RVC_GROUP },
  { key: "ocu-voice-pth", kind: "model", path: "studio-assets/voices/ocu-voice.pth", label: "Ocu model (.pth)", who: "ocu", ext: ".pth", bucket: "private", group: RVC_GROUP },
  { key: "ocu-voice-index", kind: "model", path: "studio-assets/voices/ocu-voice.index", label: "Ocu index (.index)", who: "ocu", ext: ".index", bucket: "private", group: RVC_GROUP },
];

/** The slot for a key, or null for anything outside the allowlist (no arbitrary paths). */
export function studioSlot(key: unknown): StudioSlot | null {
  return typeof key === "string" ? (STUDIO_SLOTS.find((s) => s.key === key) ?? null) : null;
}

/** Largest file a slot accepts from the picker (images are shrunk to ≤ 1024 px PNG in the browser before upload). */
export const STUDIO_MAX_BYTES = 10 * 1024 * 1024;
/** Voice models are large: up to 100 MB, uploaded straight from the phone to Storage (never through a function). */
export const MODEL_MAX_BYTES = 100 * 1024 * 1024;
export const MODEL_TYPE = "application/octet-stream";
export const maxBytesFor = (slot: StudioSlot) => (slot.kind === "model" ? MODEL_MAX_BYTES : STUDIO_MAX_BYTES);
export const STUDIO_ACCEPT: Record<StudioSlotKind, string> = { sprite: "image/*", audio: "audio/*,.mp3,.wav,.m4a,.ogg", model: ".pth,.index" };
/** The `accept` attribute for one slot (a model slot takes only its own extension). */
export const acceptFor = (slot: StudioSlot) => (slot.kind === "model" && slot.ext ? slot.ext : STUDIO_ACCEPT[slot.kind]);
/** Whether a picked file can go into a model slot: its extension must match the slot. */
export const modelFileOk = (slot: StudioSlot, fileName: string) => slot.kind === "model" && !!slot.ext && fileName.toLowerCase().endsWith(slot.ext);
/** Image types a picked original may be stored as. */
export const ORIGINAL_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/gif": "gif",
};

/** Where a sprite's original photo is kept, with the background switch's position in the name. */
export function originalPath(slot: StudioSlot, removeWhite: boolean, type: string): string | null {
  const ext = ORIGINAL_TYPES[type.toLowerCase()];
  if (slot.kind !== "sprite" || !ext) return null;
  return `originals/${slot.key}.${removeWhite ? "cut" : "keep"}.${ext}`;
}

const ORIGINAL_RX = /^originals\/((?:uco|ocu)-angry-(?:closed|open))\.(cut|keep)\.(jpg|png|webp|avif|heic|heif|gif)$/;

/** Reads an original's object path back: its slot key and the switch position. Null for anything else. */
export function parseOriginal(p: string): { key: string; removeWhite: boolean } | null {
  const m = ORIGINAL_RX.exec(p);
  return m ? { key: m[1], removeWhite: m[2] === "cut" } : null;
}

/** The image type of a stored original, from its file extension (servers don't always send the right type). */
export function originalType(urlOrPath: string): string | null {
  const ext = /\.([a-z0-9]+)(?:\?|$)/i.exec(urlOrPath.split("?")[0] + "?")?.[1]?.toLowerCase();
  return Object.entries(ORIGINAL_TYPES).find(([, e]) => e === ext)?.[0] ?? null;
}

/** True only for the object paths uploads may write: the five slot paths and the sprites' originals. */
export function isStudioObjectPath(p: unknown): boolean {
  return typeof p === "string" && (STUDIO_SLOTS.some((s) => s.path === p) || ORIGINAL_RX.test(p));
}

/** What the app knows about one slot: its public URL (cache-busted with the upload time) when it's uploaded. */
export type StudioAssetStatus = {
  key: string;
  /** public URL (sprites, audio); always null for the private voice models */
  url: string | null;
  /** uploaded (the only signal for private slots) */
  present?: boolean;
  sizeBytes?: number | null;
  updatedAt: number | null;
  /** sprites: the kept original's URL and the background switch's position */
  originalUrl: string | null;
  removeWhite: boolean;
};

/** The video's asset map for the uploaded studio files: cast sprite paths and SFX names → URL. */
export function studioVideoUrls(status: StudioAssetStatus[]): { cast: Record<string, string>; sfx: Record<string, string> } {
  const cast: Record<string, string> = {};
  const sfx: Record<string, string> = {};
  for (const st of status) {
    const slot = studioSlot(st.key);
    if (!slot || !st.url) continue;
    if (slot.kind === "sprite") cast[`${slot.who}/${slot.emotion}-${slot.frame}.png`] = st.url;
    else if (slot.kind === "audio") sfx[slot.key] = st.url;
  }
  return { cast, sfx };
}

/** Lines that call for the angry pose: an explicit "angry" pose, or an angry / furious delivery. */
export function needsAngry(lines: { emotion?: string | null; expression?: string | null; thought_bubble?: boolean | null }[]): boolean {
  return lines.some((l) => l.emotion === "angry" || (/^(angry|furious)$/.test(String(l.expression ?? "")) && !l.thought_bubble));
}

/** Cache-busting: the same URL changes whenever the file is replaced. */
export const withVersion = (url: string, updatedAt: number | null) => (updatedAt ? `${url}${url.includes("?") ? "&" : "?"}v=${updatedAt}` : url);
