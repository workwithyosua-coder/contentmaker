// Applies db/schema.sql to an empty database.  Usage: npm run db:setup
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const sql = postgres(url, { max: 1, onnotice: () => {} });

const [{ exists }] = await sql<{ exists: boolean }[]>`
  SELECT to_regclass('public.users') IS NOT NULL AS exists`;

if (exists) {
  console.log("Schema already applied (table `users` exists). Nothing to do.");
} else {
  const schema = readFileSync("db/schema.sql", "utf8");
  await sql.unsafe(schema); // simple-query protocol: multiple statements allowed
  console.log("Schema applied.");
}
await sql.end();
