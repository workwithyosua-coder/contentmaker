// Where a TTS take's real speech ends, told apart from the "chh-tsk!" Gemini puts after the last word: an unvoiced,
// broadband / high-frequency burst (static, a mouth click, end-of-stream noise) of ~150-250 ms, often right against
// the last syllable. Loudness alone can't separate them (#63's "< 140 ms after a ≥ 70 ms gap" rule cut 0 ms on all 13
// lines of the "kopi susu" episode), so each 10 ms frame is classified by its spectrum: speech-band energy
// (150-2200 Hz) against high-frequency energy (> 3200 Hz), plus the zero-crossing rate. Real Indonesian words end on
// voiced speech (strong harmonics in the speech band, few zero crossings); the burst never does, however loud it is.
// Pure (a small radix-2 FFT, no dependencies): used on Gemini's PCM before a take is stored, and in the worker.

/** Classifier settings. */
export const VOICED = {
  frameMs: 10,
  bandHz: [150, 2200] as const,
  hfHz: 3200,
  /** a frame counts as sound within 40 dB of the take's loudest frame and above −55 dBFS */
  belowPeakDb: 40,
  floorDb: -55,
  /** voiced: speech-band energy at least 6 dB above the high-frequency energy, and few zero crossings */
  marginDb: 6,
  maxZcr: 0.3,
  /** a dip of ≥ 30 ms of low speech-band energy separates the last word from a trailing burst */
  gapMs: 30,
  /** a trailing burst up to 450 ms is rejected */
  maxBurstMs: 450,
  /** an unvoiced tail touching the last voiced frame stays when it's a word's final fricative ("-s", "-h"): at most
   *  120 ms and at least 10 dB quieter than the voiced speech */
  fricativeMs: 120,
  fricativeBelowDb: 10,
  /** cut this long after the last real speech frame (then the 45 ms fade-out) */
  padMs: 45,
  /** below this share of voiced frames among the sounding ones (a whispered take), the classifier stands down */
  minVoicedShare: 0.2,
} as const;

export type TailReport = {
  /** the take's length and where it's cut (ms) */
  totalMs: number;
  endMs: number;
  /** "voiced": the spectral classifier decided; "energy": too little voiced speech, the loudness gate's end is used */
  mode: "voiced" | "energy";
  /** end of the last voiced frame (ms) */
  lastVoicedMs: number | null;
  /** the trailing part after the last voiced frame: the low-energy gap before it and the burst itself (ms) */
  gapMs: number;
  burstMs: number;
  /** the burst's spectral signature: high-frequency minus speech-band energy (dB; positive = noise-like) and ZCR */
  burstHfDb: number | null;
  burstZcr: number | null;
  /** an unvoiced tail kept as the word's final fricative */
  keptFricativeMs: number;
};

/** In-place iterative radix-2 FFT (re / im of length n, a power of two). */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export type Frame = { db: number; bandDb: number; hfDb: number; zcr: number };

/** Per-10 ms-frame features: total level, speech-band and high-frequency energy (dB), zero-crossing rate. */
export function frameFeatures(samples: ArrayLike<number>, rate: number, fullScale = 32768): Frame[] {
  const win = Math.max(1, Math.round((rate * VOICED.frameMs) / 1000));
  let n = 1;
  while (n < win) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const hann = Float64Array.from({ length: win }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, win - 1)));
  const bin = (hz: number) => Math.round((hz * n) / rate);
  const [b0, b1] = [bin(VOICED.bandHz[0]), bin(VOICED.bandHz[1])];
  const h0 = bin(VOICED.hfHz);
  const half = n / 2;
  const out: Frame[] = [];
  for (let f = 0; f + win <= samples.length; f += win) {
    re.fill(0);
    im.fill(0);
    let sum = 0;
    let zc = 0;
    let prev = 0;
    for (let i = 0; i < win; i++) {
      const v = samples[f + i] / fullScale;
      sum += v * v;
      if (i && (v >= 0) !== (prev >= 0)) zc++;
      prev = v;
      re[i] = v * hann[i];
    }
    fft(re, im);
    let band = 0;
    let hf = 0;
    for (let k = 1; k < half; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      if (k >= b0 && k <= b1) band += p;
      else if (k >= h0) hf += p;
    }
    out.push({ db: 10 * Math.log10(sum / win + 1e-12), bandDb: 10 * Math.log10(band + 1e-12), hfDb: 10 * Math.log10(hf + 1e-12), zcr: zc / win });
  }
  return out;
}

/**
 * Where to cut a take, from its spectrum: 45 ms after the last voiced frame, dropping the trailing burst after it
 * (up to 450 ms) whether it's separated by a ≥ 30 ms dip or touches the last syllable with a noise signature. Only a
 * word's own quiet final fricative (≤ 120 ms, ≥ 10 dB under the speech, touching the last voiced frame) is kept. A
 * take with too little voiced speech (a whisper) returns mode "energy" with `fallbackEndMs` as its end.
 */
export function voicedTail(samples: ArrayLike<number>, rate: number, fallbackEndMs: number, fullScale = 32768): TailReport {
  const V = VOICED;
  const fr = frameFeatures(samples, rate, fullScale);
  const totalMs = Math.round((samples.length / rate) * 1000);
  const none = { lastVoicedMs: null, gapMs: 0, burstMs: 0, burstHfDb: null, burstZcr: null, keptFricativeMs: 0 };
  if (!fr.length) return { totalMs, endMs: totalMs, mode: "energy", ...none };
  const peak = Math.max(...fr.map((x) => x.db));
  const thr = Math.max(V.floorDb, peak - V.belowPeakDb);
  const sounding = fr.map((x) => x.db >= thr);
  const voiced = fr.map((x, i) => sounding[i] && x.bandDb - x.hfDb >= V.marginDb && x.zcr <= V.maxZcr);
  const nSound = sounding.filter(Boolean).length;
  const nVoiced = voiced.filter(Boolean).length;
  if (!nVoiced || nVoiced < V.minVoicedShare * nSound) return { totalMs, endMs: Math.min(totalMs, fallbackEndMs), mode: "energy", ...none };
  let last = voiced.lastIndexOf(true);
  // the last voiced frame of real speech: a lone voiced frame inside the trailing burst doesn't count (it needs a
  // voiced neighbour within 20 ms)
  while (last > 0 && !voiced.slice(Math.max(0, last - 2), last).some(Boolean)) last = voiced.lastIndexOf(true, last - 1);
  const lastVoicedMs = (last + 1) * V.frameMs;
  // the trailing part: a low-energy gap, then the burst (sounding frames) up to the end
  let k = last + 1;
  while (k < fr.length && !sounding[k]) k++;
  const gapMs = (k - last - 1) * V.frameMs;
  const tail = fr.slice(k).filter((_, i) => sounding[k + i]);
  const burstMs = tail.length * V.frameMs;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  // (clamped: pure noise has next to no speech-band energy, which would read as +90 dB)
  const burstHfDb = tail.length ? Math.max(-40, Math.min(40, avg(tail.map((x) => x.hfDb - x.bandDb)))) : null;
  const burstZcr = tail.length ? avg(tail.map((x) => x.zcr)) : null;
  // a word's own final fricative: touching the last voiced frame, short, and well under the speech
  const voicedDb = avg(fr.filter((_, i) => voiced[i]).map((x) => x.db));
  let keptFricativeMs = 0;
  if (gapMs < V.gapMs && burstMs && burstMs <= V.fricativeMs && avg(tail.map((x) => x.db)) <= voicedDb - V.fricativeBelowDb) keptFricativeMs = burstMs;
  const endMs = Math.min(totalMs, lastVoicedMs + keptFricativeMs + V.padMs);
  return { totalMs, endMs, mode: "voiced", lastVoicedMs, gapMs, burstMs, burstHfDb: burstHfDb === null ? null : Math.round(burstHfDb * 10) / 10, burstZcr: burstZcr === null ? null : Math.round(burstZcr * 100) / 100, keptFricativeMs };
}

/** One worker-log line for a take's tail: "5721 → 5390 ms (voiced; last word 5345 ms, gap 40 ms, burst 220 ms, hf +18.2 dB, zcr 0.61)". */
export function tailSummary(r: TailReport): string {
  if (r.mode === "energy") return `${r.totalMs} → ${r.endMs} ms (energy gate: too little voiced speech to classify)`;
  const burst = r.burstMs ? `, burst ${r.burstMs} ms, hf ${r.burstHfDb! >= 0 ? "+" : ""}${r.burstHfDb} dB, zcr ${r.burstZcr}${r.keptFricativeMs ? " (kept: final fricative)" : " (cut)"}` : ", nothing after it";
  return `${r.totalMs} → ${r.endMs} ms (voiced; last word ends ${r.lastVoicedMs} ms, gap ${r.gapMs} ms${burst})`;
}
