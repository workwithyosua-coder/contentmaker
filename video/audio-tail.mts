// The tail gate in the worker (see speechEndSeconds in src/audioChain.ts): where a clip's real speech ends, read from
// the file itself. Used before RVC (so RVC never gets a trailing click or noise floor to turn into a breath), after RVC,
// after Edge TTS, and in the renderer on every take, cached ones included, before the level / loudnorm step.
import { execFileSync } from "node:child_process";
import { speechTail } from "./src/audioChain.ts";
import type { TailReport } from "./src/voicedTail.ts";

/** The clip's tail report (the voiced-speech classifier, at 48 kHz). */
export function speechTailOf(file: string): TailReport {
  const pcm = execFileSync("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", "48000", "-"], { maxBuffer: 1 << 28 });
  return speechTail(new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2)), 48000);
}

/** The clip's speech end in seconds. */
export function speechEnd(file: string): number {
  return speechTailOf(file).endMs / 1000;
}

/** An ffmpeg filter that cuts the clip at its speech end (prefix it to a chain). */
export const cutAt = (seconds: number) => `atrim=end=${seconds.toFixed(3)},`;
