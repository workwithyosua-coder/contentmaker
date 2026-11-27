// The ffmpeg filter chain every voice clip goes through before the render (render.mts) and after Edge TTS / RVC
// (edge-stage.mts, rvc-stage.mts). Pure strings, shared by the worker and the unit tests.

/**
 * Trim only what's before the first word and after the last, gently. The start uses −42 dB, above a TTS take's
 * leading breath (≈ −45 dB) but under any consonant burst, and keeps the 0.05 s before the voice crosses it, so a soft
 * "G" of "Gue" is never clipped. The end uses −50 dB with a 0.07 s tail pad.
 */
export const TRIM =
  "highpass=f=70," +
  "silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.05," +
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
  return `afade=t=in:st=0:d=0.015,afade=t=out:st=${Math.max(0, seconds - FADE_OUT_S).toFixed(3)}:d=${FADE_OUT_S}`;
}

/** The fade-out on every clip's last edge, after RVC and after Stage A when there's no RVC. */
export const FADE_OUT_S = 0.04;

/**
 * The tail gate: where a take's real speech ends. Gemini TTS takes end with a short "tsk" (a click / lip smack, about
 * 10-40 ms) roughly 0.1 s after the last word. It is above the −50 dB tail trim, so the trim stopped at it, and the
 * compressor + loudnorm then lifted it into a loud burst. Edge TTS takes end cleanly, which is why only Gemini lines
 * had it. This finds the last run of real speech (≥ 80 ms of sound within 35 dB of the take's loudest moment, with
 * dips under 90 ms bridged) and drops any short, isolated burst after it. Indonesian final stops (-t, -k, -p) are
 * unreleased, so a word's last consonant is never a separate burst. Returns the end in seconds: the speech end plus
 * a 50 ms pad, never past the take.
 */
export const TAIL_GATE = { windowMs: 10, floorDb: -50, belowPeakDb: 35, bridgeMs: 90, minSpeechMs: 80, padMs: 50 } as const;

export function speechEndSeconds(samples: ArrayLike<number>, sampleRate: number, fullScale = 32768): number {
  const g = TAIL_GATE;
  const win = Math.max(1, Math.round((sampleRate * g.windowMs) / 1000));
  const n = Math.floor(samples.length / win);
  const total = samples.length / sampleRate;
  if (!n) return total;
  const db: number[] = [];
  for (let w = 0; w < n; w++) {
    let sum = 0;
    for (let i = w * win; i < (w + 1) * win; i++) sum += (samples[i] / fullScale) ** 2;
    db.push(10 * Math.log10(sum / win + 1e-12));
  }
  const thr = Math.max(g.floorDb, Math.max(...db) - g.belowPeakDb);
  // runs of sound, with short dips (between syllables) bridged
  const runs: [number, number][] = [];
  db.forEach((d, w) => {
    if (d < thr) return;
    const last = runs.at(-1);
    if (last && (w - last[1] - 1) * g.windowMs < g.bridgeMs) last[1] = w;
    else runs.push([w, w]);
  });
  // drop short, isolated bursts at the end (the click), but never the take's only sound
  while (runs.length > 1 && (runs.at(-1)![1] - runs.at(-1)![0] + 1) * g.windowMs < g.minSpeechMs) runs.pop();
  if (!runs.length) return total;
  return Math.min(total, ((runs.at(-1)![1] + 1) * g.windowMs + g.padMs) / 1000);
}

/**
 * Natural comedic timing between lines (direction "Pacing: natural", scheduled episodes), in seconds:
 * a speaker switch lets the line land before the comeback; the same speaker carries on a little sooner; a visual
 * shift (a takeover stat card, a thought, the final punchline, the outro) gets room to breathe.
 */
export const GAPS = { switch: 0.3, same: 0.24, shift: 0.42 } as const;
