// The ffmpeg filter chain every voice clip goes through before the render (render.mts) and after Edge TTS / RVC
// (edge-stage.mts, rvc-stage.mts). Pure strings, shared by the worker and the unit tests.

/**
 * Trim only the dead silence at both ends, gently: a −50 dB threshold (soft consonants like the "G" of "Gue" count as
 * speech) keeping a 0.05 s pre-speech pad, so the first syllable is never clipped, and a 0.07 s tail pad.
 */
export const TRIM =
  "highpass=f=70," +
  "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05," +
  "areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.07,areverse";

/**
 * Inside a line, only a genuinely dead pause (below −42 dB for more than 0.5 s) is shortened, to 0.3 s. Ordinary
 * breaths and comic pauses stay: speech is never chopped mid-sentence.
 */
export const PAUSES = "silenceremove=stop_periods=-1:stop_duration=0.5:stop_threshold=-42dB:stop_silence=0.3,";

/** Inner thoughts: a subtle, clean dip (gentle EQ and a little quieter), no hollow echo or walkie-talkie band. */
export const THOUGHT_FILTER = "highpass=f=110,lowpass=f=7500,volume=-2dB,";

/** Beat 1's lead-in pad: 0.05 s of silence before the opening syllable. */
export const LEAD_IN_MS = 50;
export const LEAD_IN = `adelay=${LEAD_IN_MS}:all=1,`;

/** A 15 ms fade-in and a 35 ms fade-out on the clip's final length: no tail noise or DC offset clicks at a cut. */
export function fades(seconds: number): string {
  return `afade=t=in:st=0:d=0.015,afade=t=out:st=${Math.max(0, seconds - 0.035).toFixed(3)}:d=0.035`;
}

/**
 * Natural comedic timing between lines (direction "Pacing: natural", scheduled episodes), in seconds:
 * a speaker switch lets the line land before the comeback; the same speaker carries on a little sooner; a visual
 * shift (a takeover stat card, a thought, the final punchline, the outro) gets room to breathe.
 */
export const GAPS = { switch: 0.3, same: 0.24, shift: 0.42 } as const;
