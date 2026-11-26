// The private recordings bucket's size limit for Own-Voice model uploads, without ever blocking the upload.
// Supabase Free caps a single file at 50 MB and refuses a bucket limit above that (400 / 413 "EntityTooLarge"), so:
// ask for 100 MB (Pro), fall back to 50 MB (Free), and when even that update fails, carry on: the bucket's current
// limit still lets a < 50 MB model through. Pure code: the Storage call is passed in.

export const FREE_PLAN_FILE_LIMIT = 50 * 1024 * 1024;

export type LimitResult = { limit: number | null; note: string | null };

/** A Storage error that means "that limit is above what this project allows". */
export function isTooLarge(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(400|413)\b|EntityTooLarge|exceeded the maximum allowed size|maximum allowed size/i.test(msg);
}

/**
 * Raises the limit to `wanted`, else to the Free plan's 50 MB. Never throws: a failed bucket update is a note, not an
 * aborted upload. `limit` is the limit now known to be set (null when no update went through).
 */
export async function raiseModelLimit(raise: (bytes: number) => Promise<void>, wanted: number): Promise<LimitResult> {
  try {
    await raise(wanted);
    return { limit: wanted, note: null };
  } catch (err) {
    if (wanted > FREE_PLAN_FILE_LIMIT && isTooLarge(err)) {
      try {
        await raise(FREE_PLAN_FILE_LIMIT);
        return { limit: FREE_PLAN_FILE_LIMIT, note: "Supabase Free plan: files up to 50 MB." };
      } catch (again) {
        return { limit: null, note: `Bucket limit unchanged (${short(again)}).` };
      }
    }
    return { limit: null, note: `Bucket limit unchanged (${short(err)}).` };
  }
}

const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);

/** The message for a model over the limit the bucket ended up with (null when it fits or the limit is unknown). */
export function overLimitMessage(size: number, limit: number | null): string | null {
  if (limit === null || size <= limit) return null;
  return `This file is ${(size / 1024 / 1024).toFixed(1)} MB, over the ${limit / 1024 / 1024} MB per-file limit of your Supabase plan. Export the model as FP16 or a pruned .pth (usually under 60 MB, often under 50 MB) and upload that.`;
}
