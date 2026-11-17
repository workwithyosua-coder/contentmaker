import postgres from "postgres";

const url = process.env.DATABASE_URL;

function createClient() {
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }
  // prepare: false is required by Supabase's transaction-mode pooler (port 6543).
  return postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10, prepare: false });
}

// Reuse one pool across hot reloads in dev.
const globalForDb = globalThis as unknown as { __sql?: postgres.Sql };

export function db(): postgres.Sql {
  if (!globalForDb.__sql) globalForDb.__sql = createClient();
  return globalForDb.__sql;
}
