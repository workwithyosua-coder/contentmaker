// The ffmpeg filter chain every voice clip goes through before the render (render.mts) and after Edge TTS / RVC
// (edge-stage.mts, rvc-stage.mts). Pure strings, shared by the worker and the unit tests.

/**
 * Trim the silence at both ends. Onset: a gentle −50 dB threshold (soft consonants like the "G" of "Gue" count as
 * speech) keeps a 0.05 s pre-speech pad, so the first syllable is never clipped; the tail keeps 0.1 s.
 */
export const TRIM =
  "highpass=f=70," +
  "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05," +
  "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,areverse";

/** Pauses inside a line capped at 0.18 s (anything quieter than −38 dB for longer is cut down to 0.18 s). */
export const PAUSES = "silenceremove=stop_periods=-1:stop_duration=0.18:stop_threshold=-38dB:stop_silence=0.18,";

/** Beat 1's lead-in pad: 0.05 s of silence before the opening syllable. */
export const LEAD_IN_MS = 50;
export const LEAD_IN = `adelay=${LEAD_IN_MS}:all=1,`;

/** A 15 ms fade-in and a 35 ms fade-out on the clip's final length: no tail noise or DC offset clicks at a cut. */
export function fades(seconds: number): string {
  return `afade=t=in:st=0:d=0.015,afade=t=out:st=${Math.max(0, seconds - 0.035).toFixed(3)}:d=0.035`;
}

/** The gap between two lines in scheduled episodes (direction "Pause: 0.11s"): tight, punchy banter. */
export const LINE_GAP_S = 0.11;
