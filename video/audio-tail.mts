// The tail gate in the worker (see speechEndSeconds in src/audioChain.ts): where a clip's real speech ends, read from
// the file itself. Used before RVC (so RVC never gets a trailing click or noise floor to turn into a breath), after RVC,
// after Edge TTS, and in the renderer on every take, cached ones included, before the level / loudnorm step.
import { execFileSync } from "node:child_process";
import { speechEndSeconds } from "./src/audioChain.ts";

/** The clip's speech end in seconds (the whole clip when it can't be read). */
export function speechEnd(file: string): number {
  const pcm = execFileSync("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", "48000", "-"], { maxBuffer: 1 << 28 });
  return speechEndSeconds(new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2)), 48000);
}

/** An ffmpeg filter that cuts the clip at its speech end (prefix it to a chain). */
export const cutAt = (seconds: number) => `atrim=end=${seconds.toFixed(3)},`;
