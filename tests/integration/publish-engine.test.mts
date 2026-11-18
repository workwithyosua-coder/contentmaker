// Publishing engine against the local database with fake platform adapters: run with `npm run test:integration`.
import assert from "node:assert/strict";
import { db } from "../../src/lib/db.ts";
import { ADAPTERS, type Advance, type PublicationRow } from "../../src/lib/publish/adapters.ts";
import { publicationsFor, queuePublish, tick } from "../../src/lib/publish/engine.ts";

const sql = db();
const [user] = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
const [project] = await sql<{ id: string }[]>`
  INSERT INTO content_projects (user_id, title, target_platforms, status, platform_captions)
  VALUES (${user.id}, '[test] publish', '{tiktok,instagram,youtube,facebook}', 'awaiting_approval',
    ${sql.json({ youtube: { title: "Judul", description: "Deskripsi", tags: ["a"] }, tiktok: { caption: "Cap", hashtags: ["x", "y"] },
      instagram: { hook: "Hook", context: "Ctx", comment_prompt: "Tim Uco atau Tim Ocu?", hashtags: ["z"] }, facebook: { title: "T", description: "D" } })})
  RETURNING id`;
const [script] = await sql<{ id: string }[]>`
  INSERT INTO scripts (project_id, version, title, lines) VALUES (${project.id}, 1, 't', '[]') RETURNING id`;
const [video] = await sql<{ id: string }[]>`
  INSERT INTO episode_videos (project_id, script_id, storage_path, size_bytes) VALUES (${project.id}, ${script.id}, 'x/test.mp4', 10) RETURNING id`;
const accts: string[] = [];
for (const p of ["youtube", "tiktok", "instagram", "facebook"]) {
  const [a] = await sql<{ id: string }[]>`
    INSERT INTO social_accounts (user_id, platform, handle, external_account_id) VALUES (${user.id}, ${p}::platform_t, ${"test-" + p}, ${"test-" + p + Date.now()})
    RETURNING id`;
  accts.push(a.id);
}

const calls: Record<string, number> = { youtube: 0, tiktok: 0, instagram: 0, facebook: 0 };
let instagramFails = true;
const fake = (fn: (p: PublicationRow) => Advance) => async (p: PublicationRow) => {
  calls[p.platform]++;
  await new Promise((r) => setTimeout(r, 50));
  return fn(p);
};
ADAPTERS.youtube = fake(() => ({ status: "published", step: {}, externalId: "yt1", externalUrl: "https://youtube.com/shorts/yt1" }));
ADAPTERS.tiktok = fake((p) => (p.step.publishId ? { status: "published", step: p.step, externalId: "tt1", externalUrl: "https://tiktok.com/@x/video/tt1" } : { status: "processing", step: { publishId: "pub1" }, retryInSec: 0 }));
ADAPTERS.instagram = fake(() => (instagramFails ? { status: "failed", step: {}, error: "Instagram couldn't process the video." } : { status: "published", step: {}, externalId: "ig1", externalUrl: "https://instagram.com/p/ig1" }));
ADAPTERS.facebook = fake(() => {
  throw new Error("Graph API boom");
});

try {
  // queue: 4 platforms, captions formatted per platform, one overridden by the panel
  const queued = await queuePublish({ userId: user.id, projectId: project.id, settings: { instagram: { text: "Custom IG caption" } } });
  assert.deepEqual(queued.sort(), ["facebook", "instagram", "tiktok", "youtube"]);
  const [yt] = await sql<{ caption: { title: string; text: string } }[]>`SELECT caption FROM episode_publications WHERE video_id = ${video.id} AND platform = 'youtube'`;
  assert.equal(yt.caption.title, "Judul #Shorts");
  const [ig] = await sql<{ caption: { text: string } }[]>`SELECT caption FROM episode_publications WHERE video_id = ${video.id} AND platform = 'instagram'`;
  assert.equal(ig.caption.text, "Custom IG caption");

  // two workers at once: each row is advanced exactly once
  await Promise.all([tick(), tick()]);
  assert.deepEqual(calls, { youtube: 1, tiktok: 1, instagram: 1, facebook: 1 });
  let st = Object.fromEntries((await publicationsFor(project.id)).map((p) => [p.platform, p.status]));
  assert.deepEqual(st, { youtube: "published", tiktok: "processing", instagram: "failed", facebook: "failed" });

  // next tick finishes TikTok's processing poll; nothing else is touched
  await tick();
  st = Object.fromEntries((await publicationsFor(project.id)).map((p) => [p.platform, p.status]));
  assert.equal(st.tiktok, "published");
  assert.equal(calls.youtube, 1);

  // posting again doesn't duplicate published platforms; retry re-runs only the failed ones
  const again = await queuePublish({ userId: user.id, projectId: project.id });
  assert.deepEqual(again.sort(), ["facebook", "instagram"]);
  instagramFails = false;
  await tick();
  const pubs = await publicationsFor(project.id);
  st = Object.fromEntries(pubs.map((p) => [p.platform, p.status]));
  assert.deepEqual(st, { youtube: "published", tiktok: "published", instagram: "published", facebook: "failed" });
  assert.equal(calls.youtube, 1, "YouTube was never posted twice");
  assert.equal(pubs.find((p) => p.platform === "facebook")?.error, "Graph API boom");
  const retry = await queuePublish({ userId: user.id, projectId: project.id, onlyFailed: true });
  assert.deepEqual(retry, ["facebook"]);

  // scheduled posts wait for their time
  await sql`DELETE FROM episode_publications WHERE project_id = ${project.id}`;
  await queuePublish({ userId: user.id, projectId: project.id, at: new Date(Date.now() + 3600_000) });
  const before = { ...calls };
  await tick();
  assert.deepEqual(calls, before, "nothing runs before the scheduled time");
  console.log("publish engine: ok", calls);
} finally {
  await sql`DELETE FROM content_projects WHERE id = ${project.id}`;
  await sql`DELETE FROM social_accounts WHERE id = ANY(${accts})`;
  await sql.end();
}
