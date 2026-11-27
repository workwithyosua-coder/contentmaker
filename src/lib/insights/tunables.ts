// Live Studio Tunables: the few numbers the pipeline reads at production time (line gaps, the BGM level under speech,
// body motion, the voice's expressiveness, how many lines a script aims for). Every value is clamped to the same
// bounds as the database CHECK constraints (db/migrations/021_showrunner_playbook.sql), on every write: a Director's
// Review nudge, a hand edit on /insights, a bad form post. Pure, so it's unit-tested.

export type Tunables = {
  rapid_cut_gap_ms: number;
  standard_gap_ms: number;
  pre_punchline_gap_ms: number;
  bgm_speech_volume: number;
  motion_energy: number;
  target_line_count: number;
  voice_expressiveness: number;
};
export type TunableKey = keyof Tunables;

/** [min, max, default, step, decimals] per tunable: the server-side clamp and the form's range hint. */
export const TUNABLE_BOUNDS: Record<TunableKey, { min: number; max: number; def: number; step: number; label: string; unit: string }> = {
  rapid_cut_gap_ms: { min: 80, max: 160, def: 100, step: 5, label: "Rapid cut gap", unit: "ms" },
  standard_gap_ms: { min: 160, max: 320, def: 220, step: 5, label: "Standard gap", unit: "ms" },
  pre_punchline_gap_ms: { min: 280, max: 500, def: 380, step: 10, label: "Pre-punchline gap", unit: "ms" },
  bgm_speech_volume: { min: 0.08, max: 0.2, def: 0.13, step: 0.005, label: "BGM under speech", unit: "" },
  motion_energy: { min: 0.8, max: 1.4, def: 1, step: 0.05, label: "Motion energy", unit: "x" },
  target_line_count: { min: 12, max: 16, def: 14, step: 1, label: "Target line count", unit: "lines" },
  voice_expressiveness: { min: 0.8, max: 1.3, def: 1, step: 0.05, label: "Voice expressiveness", unit: "x" },
};
export const TUNABLE_KEYS = Object.keys(TUNABLE_BOUNDS) as TunableKey[];
export const DEFAULT_TUNABLES: Tunables = Object.fromEntries(TUNABLE_KEYS.map((k) => [k, TUNABLE_BOUNDS[k].def])) as Tunables;

const INTEGER: ReadonlySet<TunableKey> = new Set(["rapid_cut_gap_ms", "standard_gap_ms", "pre_punchline_gap_ms", "target_line_count"]);

/** One value inside its bounds (integers rounded, decimals to 3 places); a missing or non-numeric value is the default. */
export function clampTunable(key: TunableKey, value: unknown): number {
  const b = TUNABLE_BOUNDS[key];
  const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  if (!Number.isFinite(n)) return b.def;
  const c = Math.min(b.max, Math.max(b.min, n));
  return INTEGER.has(key) ? Math.round(c) : Math.round(c * 1000) / 1000;
}

/** A whole set clamped; anything missing (no row yet, a partial form) falls back to the default. */
export function clampTunables(raw: Partial<Record<TunableKey, unknown>> | null | undefined): Tunables {
  return Object.fromEntries(TUNABLE_KEYS.map((k) => [k, clampTunable(k, raw?.[k])])) as Tunables;
}

/** The Director's Review issue tags. */
export const ISSUE_TAGS = [
  "too_fast",
  "too_slow",
  "monotone_rhythm",
  "preachy_script",
  "weak_hook",
  "flat_emotion",
  "mispronunciation",
  "bgm_too_loud",
  "bgm_too_quiet",
  "too_static",
  "staging_mismatch",
] as const;
export type IssueTag = (typeof ISSUE_TAGS)[number];
export const ISSUE_LABEL: Record<IssueTag, string> = {
  too_fast: "Too fast",
  too_slow: "Too slow",
  monotone_rhythm: "Monotone rhythm",
  preachy_script: "Preachy script",
  weak_hook: "Weak hook",
  flat_emotion: "Flat emotion",
  mispronunciation: "Mispronunciation",
  bgm_too_loud: "BGM too loud",
  bgm_too_quiet: "BGM too quiet",
  too_static: "Too static",
  staging_mismatch: "Staging mismatch",
};
export const RATINGS = ["winner", "needs_work", "unwatchable"] as const;
export type Rating = (typeof RATINGS)[number];
export const RATING_LABEL: Record<Rating, string> = { winner: "Winner", needs_work: "Needs work", unwatchable: "Unwatchable" };

export const asIssueTags = (raw: unknown[]): IssueTag[] => [...new Set(raw.map(String).filter((t): t is IssueTag => (ISSUE_TAGS as readonly string[]).includes(t)))];
export const asRating = (raw: unknown): Rating | null => ((RATINGS as readonly string[]).includes(String(raw)) ? (raw as Rating) : null);

/** What each tag moves. Tags not listed here teach through the notes and the playbook, not a number. */
export const NUDGES: Partial<Record<IssueTag, { key: TunableKey; delta: number }>> = {
  too_fast: { key: "standard_gap_ms", delta: 25 },
  too_slow: { key: "standard_gap_ms", delta: -25 },
  bgm_too_loud: { key: "bgm_speech_volume", delta: -0.015 },
  bgm_too_quiet: { key: "bgm_speech_volume", delta: 0.015 },
  too_static: { key: "motion_energy", delta: 0.1 },
  flat_emotion: { key: "voice_expressiveness", delta: 0.1 },
};

export type Adjustment = { key: TunableKey; label: string; from: number; to: number; clamped: boolean };

/**
 * The review's tags applied to the current tunables, each step clamped. Opposite tags in one review ("too fast" and
 * "too slow") cancel out. A nudge that hits a bound says so (`clamped`); one that can't move at all isn't listed.
 */
export function applyNudges(current: Tunables, tags: readonly string[]): { next: Tunables; adjustments: Adjustment[] } {
  const next = clampTunables(current);
  const base = { ...next };
  const wanted = new Map<TunableKey, number>();
  for (const t of new Set(tags)) {
    const n = NUDGES[t as IssueTag];
    if (n) wanted.set(n.key, (wanted.get(n.key) ?? 0) + n.delta);
  }
  const adjustments: Adjustment[] = [];
  for (const [key, delta] of wanted) {
    if (Math.abs(delta) < 1e-9) continue;
    const raw = base[key] + delta;
    const to = clampTunable(key, raw);
    if (to === base[key]) continue;
    next[key] = to;
    adjustments.push({ key, label: TUNABLE_BOUNDS[key].label, from: base[key], to, clamped: Math.abs(to - raw) > 1e-9 });
  }
  return { next, adjustments };
}

/** "Standard gap 220 → 245 ms", "BGM under speech 0.2 → 0.185" (an adjustment, for the Saved state). */
export function adjustmentText(a: Adjustment): string {
  const unit = TUNABLE_BOUNDS[a.key].unit;
  return `${a.label} ${a.from} → ${a.to}${unit && unit !== "x" ? ` ${unit}` : unit}${a.clamped ? " (at its limit)" : ""}`;
}

/** The acting cue the voice expressiveness adds to a Gemini TTS style (none at the neutral 0.95-1.05). */
export function expressivenessCue(x: number | null | undefined): string | null {
  const v = clampTunable("voice_expressiveness", x ?? 1);
  if (v >= 1.2) return "very expressive, big emotional contrast between words, vivid and theatrical";
  if (v > 1.05) return "extra expressive, bigger emotional contrast";
  if (v < 0.9) return "restrained and understated, subtle emotion";
  if (v < 0.95) return "a little more restrained";
  return null;
}
