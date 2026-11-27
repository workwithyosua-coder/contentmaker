// Pacing for gemini-3.8-flash-tts on the Gemini API's Tier 1 (10 requests a minute for the TTS model): at most 9 a
// minute, and a 429 is retried (Retry-After, Google's RetryInfo, else exponential backoff) up to 3 times before the
// scheduler falls back to Edge TTS, so every line of an episode stays on one expressive voice engine.
// Pure: the clock and the sleep are injected (unit-tested without waiting).

/** Requests a minute we allow ourselves (the limit is 10). */
export const TTS_RPM = 9;
/** The gap between two TTS request starts. */
export const TTS_MIN_INTERVAL_MS = Math.ceil(60_000 / TTS_RPM);
/** Test-only overrides (the browser tests run against a fake Gemini that has no rate limit). */
const envMs = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 && process.env[name] !== undefined && process.env[name] !== "" ? v : fallback;
};
/** Retries of one line after a 429, before the scheduler hands the rest to Edge TTS. */
export const TTS_MAX_429_RETRIES = 3;
/** The longest single wait after a 429 (keeps a function well inside its 300 s). */
export const TTS_MAX_RETRY_WAIT_MS = 45_000;

type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };
export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/** Spaces request starts at least TTS_MIN_INTERVAL_MS apart (one per warm function instance). */
export class TtsPacer {
  private last = -Infinity;
  constructor(private clock: Clock = realClock, private interval = envMs("TTS_MIN_INTERVAL_MS", TTS_MIN_INTERVAL_MS)) {}
  /** Waits (if needed) for the next free slot, then claims it. Returns how long it waited. */
  async slot(): Promise<number> {
    const wait = Math.max(0, this.last + this.interval - this.clock.now());
    if (wait) await this.clock.sleep(wait);
    this.last = this.clock.now();
    return wait;
  }
}

/**
 * How long to wait before retry `attempt` (1-based) after a 429: the Retry-After header (seconds), else the
 * RetryInfo "retryDelay" Google puts in the error body ("17s"), else 4 s, 8 s, 16 s; never more than 45 s.
 */
export function retryDelayMs(attempt: number, retryAfter: string | null, body: string): number {
  const header = Number(retryAfter);
  if (retryAfter && Number.isFinite(header) && header >= 0) return Math.min(TTS_MAX_RETRY_WAIT_MS, header * 1000);
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  if (m) return Math.min(TTS_MAX_RETRY_WAIT_MS, Math.ceil(Number(m[1]) * 1000));
  return Math.min(TTS_MAX_RETRY_WAIT_MS, envMs("TTS_RETRY_BASE_MS", 4000) * 2 ** (attempt - 1));
}

/**
 * One paced TTS request with 429 retries: `call` makes the request; a 429 waits retryDelayMs and tries again, up to 3
 * times (each try is paced too). Returns the last response (still a 429 when every retry was refused).
 */
export async function pacedRequest<R extends { status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>(
  call: () => Promise<R>,
  pacer: TtsPacer,
  clock: Clock = realClock,
  onRetry?: (attempt: number, waitMs: number) => void,
): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    await pacer.slot();
    const res = await call();
    if (res.status !== 429 || attempt >= TTS_MAX_429_RETRIES) return res;
    // this 429 is retried, so its body is only read for Google's retryDelay
    const wait = retryDelayMs(attempt + 1, res.headers.get("retry-after"), await res.text().catch(() => ""));
    onRetry?.(attempt + 1, wait);
    await clock.sleep(wait);
  }
}
