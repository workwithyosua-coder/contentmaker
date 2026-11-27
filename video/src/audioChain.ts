import { voicedTail, type TailReport } from "./voicedTail";
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
export const FADE_OUT_S = 0.045;

/**
 * The tail gate: where a take's real speech ends. Gemini TTS takes end with a short "tsk" (a click / lip smack, about
 * 10-40 ms) roughly 0.1 s after the last word. It is above the −50 dB tail trim, so the trim stopped at it, and the
 * compressor + loudnorm then lifted it into a loud burst. Edge TTS takes end cleanly, which is why only Gemini lines
 * had it. This works on 10 ms frames: sound within 35 dB of the take's loudest frame (and above −50 dB) is voiced,
 * dips under 70 ms between syllables are bridged, a trailing transient under 140 ms that comes 70 ms or more after
 * the last word is dropped, and the take ends on its last sustained voiced region (≥ 60 ms). Indonesian final stops
 * (-t, -k, -p) are unreleased, so a word's last consonant is never a separate burst. Returns the end in seconds: the
 * speech end plus a 55 ms natural-decay pad, never past the take (then a 45 ms fade-out).
 */
export const TAIL_GATE = { windowMs: 10, floorDb: -50, belowPeakDb: 35, bridgeMs: 70, minSpeechMs: 60, transientMs: 140, padMs: 55 } as const;

export function speechEndSeconds(samples: ArrayLike<number>, sampleRate: number, fullScale = 32768): number {
  return speechTail(samples, sampleRate, fullScale).endMs / 1000;
}

/**
 * The take's tail, decided by its spectrum (voicedTail.ts: the last voiced frame + 45 ms, any unvoiced trailing burst
 * up to 450 ms cut), falling back to the loudness gate below for a take with too little voiced speech (a whisper).
 * The report carries the diagnostics the worker logs.
 */
export function speechTail(samples: ArrayLike<number>, sampleRate: number, fullScale = 32768): TailReport {
  return voicedTail(samples, sampleRate, energyEndSeconds(samples, sampleRate, fullScale) * 1000, fullScale);
}

/** The loudness-only gate (#59 / #63): the fallback when a take has too little voiced speech to classify. */
export function energyEndSeconds(samples: ArrayLike<number>, sampleRate: number, fullScale = 32768): number {
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
  // a trailing transient (a click, a lip smack: under 140 ms, 70 ms or more after the last word) is dropped, and the
  // take ends on its last sustained voiced region (at least 60 ms), never its only sound
  const len = (r: [number, number]) => (r[1] - r[0] + 1) * g.windowMs;
  while (runs.length > 1 && len(runs.at(-1)!) < g.transientMs) runs.pop();
  while (runs.length > 1 && len(runs.at(-1)!) < g.minSpeechMs) runs.pop();
  if (!runs.length) return total;
  return Math.min(total, ((runs.at(-1)![1] + 1) * g.windowMs + g.padMs) / 1000);
}

/**
 * Ping-pong comedy timing between lines (direction "Pacing: natural", scheduled episodes), in seconds: a rapid-fire
 * interjection or a snap reaction (≤ 7 words, or a shocked / defensive line) comes in almost on top (0.10 s); a
 * standard banter cut 0.22 s; a beat drop before a takeover stat card, the final punchline or the outro 0.38 s.
 */
export const GAPS = { rapid: 0.1, standard: 0.22, drop: 0.38 } as const;
/** A line this short (words) is a rapid-fire interjection ("Hah, serius lo?!"). */
export const INTERJECTION_WORDS = 7;
