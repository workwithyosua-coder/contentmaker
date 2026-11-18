// Splits one full voice-over recording into one clip per script line. Pure functions (no DOM, no audio APIs), so
// the browser runs them on the decoded samples and the tests run them on synthetic ones.
//
// 1. Loudness per 10 ms frame → the pauses between phrases (quiet runs of at least 0.12 s).
// 2. Where each line should end if the lines were spoken at an even pace (from each line's word count).
// 3. Pick the pauses that best match those positions, preferring long pauses (dynamic programming over the pauses).

export const HOP_S = 0.01;
const MIN_GAP_S = 0.12; // short enough to catch a quick reply; the line-length fit keeps breaths inside a line from winning
const EDGE_PAD_S = 0.15;

export type Gap = { start: number; end: number }; // seconds
export type Split = {
  gaps: Gap[]; // every pause found, in order
  cuts: number[]; // N-1 cut times in seconds (each in the middle of a pause, or a guess when there weren't enough)
  chosen: (number | null)[]; // index into gaps for each cut, null = no pause matched (placed by line length)
  speechStart: number;
  speechEnd: number;
};

/** RMS loudness per 10 ms frame of mono samples. */
export function frameLoudness(samples: Float32Array, sampleRate: number) {
  const hop = Math.max(1, Math.round(sampleRate * HOP_S));
  const out = new Float32Array(Math.ceil(samples.length / hop));
  for (let f = 0; f < out.length; f++) {
    let s = 0;
    const end = Math.min(samples.length, (f + 1) * hop);
    for (let i = f * hop; i < end; i++) s += samples[i] * samples[i];
    out[f] = Math.sqrt(s / Math.max(1, end - f * hop));
  }
  return out;
}

const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-6));

/** Quiet runs between speech, found relative to this recording's own noise floor and speech level. */
export function findGaps(rms: Float32Array) {
  const sorted = Array.from(rms, db).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? -90;
  const speech = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const threshold = floor + 0.3 * (speech - floor);
  const loud = Array.from(rms, (v) => db(v) > threshold);
  // fill single dropouts inside words (plosives, short syllable breaks) so they don't count as pauses
  const first = loud.indexOf(true);
  const last = loud.lastIndexOf(true);
  if (first < 0) return { gaps: [] as Gap[], speechStart: 0, speechEnd: rms.length * HOP_S };
  const gaps: Gap[] = [];
  let run = -1;
  for (let f = first; f <= last + 1; f++) {
    const quiet = f <= last && !loud[f];
    if (quiet && run < 0) run = f;
    if (!quiet && run >= 0) {
      if ((f - run) * HOP_S >= MIN_GAP_S) gaps.push({ start: run * HOP_S, end: f * HOP_S });
      run = -1;
    }
  }
  return { gaps, speechStart: first * HOP_S, speechEnd: (last + 1) * HOP_S };
}

/** Chooses N-1 cut points for N lines whose relative lengths are `weights` (e.g. word counts). */
export function splitLines(rms: Float32Array, weights: number[]): Split {
  const { gaps, speechStart, speechEnd } = findGaps(rms);
  const n = weights.length;
  const span = Math.max(0.1, speechEnd - speechStart);
  const total = weights.reduce((a, w) => a + Math.max(1, w), 0);
  const expected: number[] = [];
  let acc = 0;
  for (let k = 0; k < n - 1; k++) {
    acc += Math.max(1, weights[k]);
    expected.push(speechStart + (span * acc) / total);
  }
  if (n <= 1) return { gaps, cuts: [], chosen: [], speechStart, speechEnd };

  const mid = (g: Gap) => (g.start + g.end) / 2;
  const perLine = span / n;
  // reward a long pause, penalise distance from where the line "should" end
  const score = (k: number, g: number) => 2 * Math.min(1.5, gaps[g].end - gaps[g].start) - Math.abs(mid(gaps[g]) - expected[k]) / perLine;

  const m = n - 1;
  if (gaps.length >= m) {
    // best[k][g]: best total for cuts 0..k with cut k at gap g (gaps strictly increasing)
    const best: number[][] = Array.from({ length: m }, () => new Array(gaps.length).fill(-Infinity));
    const from: number[][] = Array.from({ length: m }, () => new Array(gaps.length).fill(-1));
    for (let g = 0; g < gaps.length; g++) best[0][g] = score(0, g);
    for (let k = 1; k < m; k++) {
      let runBest = -Infinity;
      let runArg = -1;
      for (let g = k; g < gaps.length; g++) {
        if (best[k - 1][g - 1] > runBest) {
          runBest = best[k - 1][g - 1];
          runArg = g - 1;
        }
        if (runArg >= 0) {
          best[k][g] = runBest + score(k, g);
          from[k][g] = runArg;
        }
      }
    }
    let g = 0;
    for (let i = 1; i < gaps.length; i++) if (best[m - 1][i] > best[m - 1][g]) g = i;
    const chosen: number[] = new Array(m);
    for (let k = m - 1; k >= 0; k--) {
      chosen[k] = g;
      g = from[k][g];
    }
    return { gaps, cuts: chosen.map((i) => mid(gaps[i])), chosen, speechStart, speechEnd };
  }
  // fewer pauses than line breaks: use each pause for the nearest expected break, guess the rest by line length
  const chosen: (number | null)[] = new Array(m).fill(null);
  const used = new Set<number>();
  gaps.forEach((gap, gi) => {
    let k = -1;
    for (let i = 0; i < m; i++) if (chosen[i] === null && (k < 0 || Math.abs(expected[i] - mid(gap)) < Math.abs(expected[k] - mid(gap)))) k = i;
    if (k >= 0 && !used.has(gi)) {
      chosen[k] = gi;
      used.add(gi);
    }
  });
  const cuts = expected.map((e, k) => (chosen[k] === null ? e : mid(gaps[chosen[k]!])));
  for (let k = 1; k < m; k++) if (cuts[k] <= cuts[k - 1]) cuts[k] = cuts[k - 1] + 0.1; // keep order
  return { gaps, cuts, chosen, speechStart, speechEnd };
}

/** Clip boundaries in seconds for each line, from the cuts (a little silence kept at both ends of the recording). */
export function segments(split: Pick<Split, "cuts" | "speechStart" | "speechEnd">, duration: number) {
  const edges = [Math.max(0, split.speechStart - EDGE_PAD_S), ...split.cuts, Math.min(duration, split.speechEnd + EDGE_PAD_S * 2)];
  return edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1] }));
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return buf;
}
