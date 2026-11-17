// Seeds ~90 days of realistic demo posts + metrics so the dashboard works before
// your real social accounts are connected.  Usage: npm run db:seed   (add --reset to wipe demo data first)
//
// The demo data has REAL patterns baked in (e.g. contrarian hooks win on TikTok, 15-30s is the sweet spot,
// a face in the first 2 seconds helps) so the Analyst agent has something true to discover.
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const sql = postgres(url, { max: 1, onnotice: () => {} });

// ---------- deterministic randomness ----------
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());

const DEMO_EMAIL = process.env.OWNER_EMAIL || "owner@example.com";

if (process.argv.includes("--reset")) {
  await sql`DELETE FROM users WHERE email = ${DEMO_EMAIL}`;
  await sql`DELETE FROM editing_styles WHERE user_id IS NULL AND slug LIKE 'demo-%'`;
  console.log("Demo data removed.");
}

const existing = await sql`SELECT id FROM users WHERE email = ${DEMO_EMAIL}`;
if (existing.length) {
  console.log(`User ${DEMO_EMAIL} already exists — run with --reset to re-seed.`);
  await sql.end();
  process.exit(0);
}

// ---------- user, accounts, styles ----------
const userId = randomUUID();
await sql`INSERT INTO users (id, email, display_name, timezone) VALUES (${userId}, ${DEMO_EMAIL}, 'You', 'UTC')`;

type Platform = "instagram" | "tiktok" | "youtube";
const accounts: Record<Platform, { id: string; baseViews: number; followers: number }> = {
  instagram: { id: randomUUID(), baseViews: 4200, followers: 6800 },
  tiktok: { id: randomUUID(), baseViews: 9000, followers: 12400 },
  youtube: { id: randomUUID(), baseViews: 2600, followers: 3100 },
};
for (const [platform, a] of Object.entries(accounts)) {
  await sql`INSERT INTO social_accounts (id, user_id, platform, handle, external_account_id, last_synced_at)
            VALUES (${a.id}, ${userId}, ${platform}, ${"@demo_" + platform}, ${"demo-" + platform}, now())`;
}

const styles = [
  { slug: "demo-fast-cut", name: "Fast-cut, bold captions", mult: { instagram: 1.45, tiktok: 1.6, youtube: 0.9 }, completion: 1.2 },
  { slug: "demo-talking-head", name: "Clean talking head", mult: { instagram: 1.0, tiktok: 0.95, youtube: 1.15 }, completion: 1.0 },
  { slug: "demo-broll-story", name: "B-roll storytelling", mult: { instagram: 1.15, tiktok: 1.0, youtube: 1.25 }, completion: 1.05 },
  { slug: "demo-calm-vlog", name: "Calm vlog", mult: { instagram: 0.8, tiktok: 0.7, youtube: 1.0 }, completion: 0.85 },
] as const;
const styleIds: Record<string, string> = {};
for (const s of styles) {
  const id = randomUUID();
  styleIds[s.slug] = id;
  await sql`INSERT INTO editing_styles (id, user_id, slug, name, template_id, params)
            VALUES (${id}, NULL, ${s.slug}, ${s.name}, ${s.slug}, ${sql.json({ demo: true })})`;
}

// ---------- feature effects (the "truth" the Analyst should find) ----------
const hookMult: Record<string, Record<Platform, number>> = {
  contrarian: { instagram: 1.35, tiktok: 1.95, youtube: 1.2 },
  question:   { instagram: 1.1,  tiktok: 1.05, youtube: 1.0 },
  listicle:   { instagram: 1.2,  tiktok: 1.0,  youtube: 1.5 },
  story:      { instagram: 1.05, tiktok: 1.1,  youtube: 1.05 },
  tutorial:   { instagram: 0.95, tiktok: 0.85, youtube: 1.45 },
  pov:        { instagram: 1.15, tiktok: 1.35, youtube: 0.8 },
};
const durations = [
  { bucket: "<15s", sec: 11, mult: 0.9, completion: 0.55 },
  { bucket: "15-30s", sec: 24, mult: 1.25, completion: 0.4 },
  { bucket: "30-60s", sec: 45, mult: 1.0, completion: 0.27 },
  { bucket: "60s+", sec: 95, mult: 0.7, completion: 0.16 },
];
const topics = {
  productivity: ["Stop using to-do lists", "My 3-hour workday system", "Why mornings are overrated", "The 2-minute rule is wrong"],
  freelancing: ["Raise your rates today", "How I land clients without cold email", "Never do free trials", "My first $10k month"],
  tools: ["5 apps I can't live without", "Notion setup tour", "AI tools that actually save time", "My desk setup"],
  mindset: ["Burnout isn't a badge", "Consistency beats talent", "What 30 days of posting taught me", "Stop waiting to feel ready"],
};
const growth = [[1, 0.05], [6, 0.2], [24, 0.55], [72, 0.8], [168, 0.93], [720, 1]] as const;

const now = Date.now();
const DAY = 86_400_000;
let postCount = 0;
const followsByAccountDay = new Map<string, number>();

for (const platform of Object.keys(accounts) as Platform[]) {
  const acct = accounts[platform];
  const everyDays = platform === "youtube" ? 3 : 1.6;
  for (let d = 90; d >= 0.5; d -= everyDays * (0.7 + rand() * 0.6)) {
    const hook = pick(Object.keys(hookMult));
    const style = pick(styles);
    const dur = platform === "youtube" && rand() < 0.4 ? durations[3] : pick(durations);
    const pillar = pick(Object.keys(topics) as (keyof typeof topics)[]);
    const topic = pick(topics[pillar]);
    const face = rand() < 0.6;
    const hour = pick([7, 9, 12, 13, 17, 18, 19, 20, 21, 22]);
    const publishedAt = new Date(now - d * DAY);
    publishedAt.setUTCHours(hour, 0, 0, 0);
    if (publishedAt.getTime() > now - 3_600_000) continue;

    const hourMult = hour >= 18 && hour <= 21 ? 1.2 : hour <= 9 ? 0.8 : 1.0;
    const finalViews = Math.round(
      acct.baseViews * hookMult[hook][platform] * style.mult[platform] * dur.mult * (face ? 1.25 : 1) * hourMult *
        Math.exp(0.45 * gauss()),
    );
    const likeRate = 0.045 + rand() * 0.035;
    const shareRate = 0.004 * (hook === "contrarian" ? 1.7 : 1) * (1 + 0.3 * gauss() ** 2);
    const saveRate = 0.006 * (hook === "tutorial" || hook === "listicle" ? 2.1 : 1);
    const completion = Math.min(0.95, dur.completion * style.completion * (face ? 1.1 : 1) * Math.exp(0.15 * gauss()));
    const followRate = 0.002 * (hook === "contrarian" || hook === "story" ? 1.5 : 1);

    const postId = randomUUID();
    await sql`INSERT INTO posts (id, user_id, social_account_id, platform, format, external_post_id, permalink,
                                 caption_text, duration_s, status, published_at)
              VALUES (${postId}, ${userId}, ${acct.id}, ${platform}, 'short_video', ${"demo-" + postId.slice(0, 8)},
                      NULL, ${topic}, ${dur.sec}, 'published', ${publishedAt})`;
    await sql`INSERT INTO post_features (post_id, pillar, topic, hook_type, hook_text, editing_style_id, duration_bucket,
                                         has_face_in_first_2s, has_on_screen_text, posted_dow, posted_hour)
              VALUES (${postId}, ${pillar}, ${topic}, ${hook}, ${topic}, ${styleIds[style.slug]}, ${dur.bucket},
                      ${face}, ${style.slug === "demo-fast-cut"}, ${publishedAt.getUTCDay()}, ${hour})`;

    const ageH = (now - publishedAt.getTime()) / 3_600_000;
    const snaps = growth.filter(([h]) => h <= ageH);
    // partial-curve point for very fresh posts
    if (!snaps.length || snaps[snaps.length - 1][0] < ageH) {
      const prev = snaps.length ? snaps[snaps.length - 1] : [0, 0];
      const next = growth.find(([h]) => h > ageH);
      if (next) {
        const f = prev[1] + ((next[1] - prev[1]) * (ageH - prev[0])) / (next[0] - prev[0]);
        (snaps as [number, number][]).push([Math.round(ageH * 100) / 100, f]);
      }
    }
    for (const [h, f] of snaps) {
      const v = Math.round(finalViews * f);
      await sql`INSERT INTO post_metric_snapshots (post_id, captured_at, hours_since_publish, views, reach, likes, comments,
                                                   shares, saves, follows_gained, avg_view_duration_s, completion_rate)
                VALUES (${postId}, ${new Date(publishedAt.getTime() + h * 3_600_000)}, ${h}, ${v}, ${Math.round(v * 0.82)},
                        ${Math.round(v * likeRate)}, ${Math.round(v * 0.003)}, ${Math.round(v * shareRate)},
                        ${Math.round(v * saveRate)}, ${Math.round(v * followRate)},
                        ${Math.round(dur.sec * completion * 100) / 100}, ${Math.round(completion * 10000) / 10000})`;
    }
    const dayKey = `${platform}|${publishedAt.toISOString().slice(0, 10)}`;
    followsByAccountDay.set(dayKey, (followsByAccountDay.get(dayKey) ?? 0) + Math.round(finalViews * followRate));
    postCount++;
  }

  // daily follower series
  let followers = acct.followers;
  for (let d = 90; d >= 0; d--) {
    const day = new Date(now - d * DAY).toISOString().slice(0, 10);
    const delta = (followsByAccountDay.get(`${platform}|${day}`) ?? 0) + Math.round(5 + rand() * 10);
    followers += delta;
    await sql`INSERT INTO account_metric_daily (social_account_id, day, followers, followers_delta)
              VALUES (${acct.id}, ${day}, ${followers}, ${delta})`;
  }
}

await sql`INSERT INTO content_directions (user_id, title, prompt, goal, target_audience, pillars, platforms, cadence_per_week)
          VALUES (${userId}, 'Freelancer productivity', 'Contrarian, practical short videos about productivity for freelancers',
                  'followers', 'Freelancers and solo creators', ${["productivity", "freelancing", "tools", "mindset"]},
                  ${["instagram", "tiktok", "youtube"]}::platform_t[], 5)`;

await sql`REFRESH MATERIALIZED VIEW post_performance`;
console.log(`Seeded ${postCount} demo posts across 3 accounts for ${DEMO_EMAIL}.`);
await sql.end();
