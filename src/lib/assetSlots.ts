// Slot-based naming for uploaded props and sound effects. The user's own file name (IMG_4821.jpg, 1000100991.m4a)
// is never used: a file uploaded into the `props/mie-pedas-level10.png` slot is always stored as
// props/mie-pedas-level10.png, and an audio file in the `sfx/slurp.mp3` slot as sfx/slurp.{its real format}.
// Pure (no DOM, no Node APIs): shared by the browser uploader, the server actions and the unit tests.

export type AssetKind = "props" | "sfx";

/** Slot names are the asset keys the beats ask for: lowercase words joined by dashes. */
export const isSlotName = (n: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(n) && n.length <= 40;

/** Audio formats a slot accepts → stored extension (the browser's MIME type, or the file extension as a fallback). */
export const AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/x-ogg": "ogg",
};
const AUDIO_EXT: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg" };

/** The `accept` attribute for each kind of slot. */
export const SLOT_ACCEPT: Record<AssetKind, string> = { props: "image/*", sfx: "audio/*,.mp3,.wav,.m4a,.ogg" };

/** Largest file a user may pick (images are shrunk and converted before they're uploaded). */
export const MAX_PICK_BYTES = 10 * 1024 * 1024;

/**
 * The upload type for an audio file: its MIME type when the browser knows it, else from its extension
 * (phone galleries often report "" or "application/octet-stream"). Null when it isn't a supported audio format.
 */
export function audioUploadType(file: { type: string; name: string }): { type: string; ext: string } | null {
  const t = file.type.toLowerCase().split(";")[0].trim();
  if (AUDIO_TYPES[t]) return { type: t, ext: AUDIO_TYPES[t] };
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (ext && AUDIO_EXT[ext]) return { type: AUDIO_EXT[ext], ext };
  return null;
}

/**
 * The stored file name for an upload into a slot. Props are always converted to PNG in the browser, so a prop slot is
 * always `{name}.png`; an audio slot keeps the slot name with the file's real format.
 */
export function slotFileName(kind: AssetKind, name: string, file: { type: string; name: string }): string | null {
  if (!isSlotName(name)) return null;
  if (kind === "props") return `${name}.png`;
  const audio = audioUploadType(file);
  return audio ? `${name}.${audio.ext}` : null;
}

/** "props/mie-pedas-level10.png" → { kind: "props", name: "mie-pedas-level10" }. */
export function slotFromFile(file: string): { kind: AssetKind; name: string } | null {
  const m = /^(props|sfx)\/([a-z0-9]+(?:-[a-z0-9]+)*)\.[a-z0-9]+$/.exec(file);
  return m ? { kind: m[1] as AssetKind, name: m[2] } : null;
}
