import postgres from "postgres";

const url = process.env.DATABASE_URL;

function createClient() {
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }
  return postgres(url, DB_POOL);
}

/**
 * The per-instance pool. On Vercel each warm function instance holds its own pool, so a few busy instances × 5
 * connections exhausted Supabase's session pooler (EMAXCONNSESSION). Two connections per instance, closed after 10 s
 * idle and recycled every 5 minutes, keep the total small. prepare: false (no named prepared statements) and nothing
 * session-scoped (no LISTEN, advisory locks or SET; transactions run inside sql.begin) make the same settings work on
 * Supabase's transaction pooler (port 6543). DB_POOL_MAX overrides the size.
 */
export const DB_POOL = {
  max: Math.max(1, Math.min(5, Number(process.env.DB_POOL_MAX) || 2)),
  idle_timeout: 10,
  max_lifetime: 5 * 60,
  connect_timeout: 10,
  prepare: false,
} as const;

/**
 * A database error worth retrying rather than failing the work: the pooler is out of client slots
 * (EMAXCONNSESSION, "max clients reached", "too many clients", "remaining connection slots"), or the connection
 * couldn't be made / was dropped (refused, reset, timed out, terminated).
 */
export function isDbPoolError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  const text = `${String(e?.code ?? "")} ${String(e?.message ?? err ?? "")}`;
  return /EMAXCONN|max ?client|too many (clients|connections)|remaining connection slots|53300|ECONNREFUSED|ECONNRESET|ETIMEDOUT|CONNECT_TIMEOUT|CONNECTION_(CLOSED|DESTROYED|ENDED)|Connection terminated|terminating connection/i.test(text);
}

// Reuse one pool across hot reloads in dev.
const globalForDb = globalThis as unknown as { __sql?: postgres.Sql };

export function db(): postgres.Sql {
  if (!globalForDb.__sql) globalForDb.__sql = createClient();
  return globalForDb.__sql;
}
