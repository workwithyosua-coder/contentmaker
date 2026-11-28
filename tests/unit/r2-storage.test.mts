// Cloudflare R2 media storage: key prefixes per old Supabase bucket, presigned GET / PUT URLs (lifetimes, no SDK
// checksum that would break browser uploads), the Supabase fallback when R2_* is unset or an older object isn't in R2
// yet (driven through the real storage.ts against a fake R2 + fake Supabase), the public-asset redirect, the copy
// script's safety, the workflows' R2 secrets, and <video preload="metadata">.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { clampExpiry, fromR2Key, PRESIGN, presignGet, presignPut, r2Config, r2ErrorInfo, r2Key, STORAGE_AREAS } from "../../src/lib/r2.ts";
import { ROOT } from "./importGraph.mts";

const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const ENV = { R2_ACCOUNT_ID: "acct123", R2_ACCESS_KEY_ID: "AKIDTEST", R2_SECRET_ACCESS_KEY: "s3cr3t", R2_BUCKET_NAME: "dapur-media" };

test("R2 is used only when all four R2_* variables are set; the account's R2 endpoint, region auto", () => {
  const cfg = r2Config(ENV)!;
  assert.equal(cfg.endpoint, "https://acct123.r2.cloudflarestorage.com");
  assert.equal(cfg.bucket, "dapur-media");
  assert.equal(cfg.pathStyle, false);
  for (const k of Object.keys(ENV)) assert.equal(r2Config({ ...ENV, [k]: "" }), null, `${k} missing → Supabase`);
  assert.equal(r2Config({}), null);
  const src = read("src/lib/r2.ts");
  assert.match(src, /new S3Client\(\{\s*region: "auto",/);
});

test("key prefixes: each old Supabase bucket is a prefix in the one R2 bucket; no traversal, no unknown bucket", () => {
  assert.deepEqual([...STORAGE_AREAS], ["recordings", "studio-assets", "custom-assets"]);
  assert.equal(r2Key("recordings", "ep-1/script-2/line-01-uco-take-1.webm"), "recordings/ep-1/script-2/line-01-uco-take-1.webm");
  assert.equal(r2Key("studio-assets", "sprites/uco-angry-closed.png"), "studio-assets/sprites/uco-angry-closed.png");
  assert.equal(r2Key("custom-assets", "/props/sate-padang.png"), "custom-assets/props/sate-padang.png", "a leading slash is dropped");
  assert.throws(() => r2Key("custom-assets", "../recordings/ep-1/x.webm"), /Bad storage path/);
  assert.throws(() => r2Key("custom-assets", "props/./x.png"), /Bad storage path/);
  assert.throws(() => r2Key("other-bucket", "x.png"), /Unknown storage bucket/);
  assert.deepEqual(fromR2Key("studio-assets/sprites/x.png"), { bucket: "studio-assets", path: "sprites/x.png" });
  assert.equal(fromR2Key("nope/x.png"), null);
});

test("presigned URLs: GET for playback / downloads / publishing, PUT for uploads, sensible lifetimes, no SDK checksum", async () => {
  const cfg = r2Config(ENV)!;
  const get = new URL(await presignGet(cfg, r2Key("recordings", "ep-1/video/v3.mp4"), PRESIGN.publish));
  assert.equal(get.host, "dapur-media.acct123.r2.cloudflarestorage.com");
  assert.equal(get.pathname, "/recordings/ep-1/video/v3.mp4");
  assert.equal(get.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assert.match(get.searchParams.get("X-Amz-Credential")!, /^AKIDTEST\/\d{8}\/auto\/s3\/aws4_request$/);
  assert.equal(get.searchParams.get("X-Amz-Expires"), String(24 * 3600), "publishers get a day: IG / FB may queue the download for hours");
  assert.ok(!get.searchParams.has("x-amz-checksum-mode"), "no checksum mode on GET");
  // a download saves under a file name signed into the URL (never appended afterwards)
  const dl = new URL(await presignGet(cfg, r2Key("recordings", "ep-1/video/v3.mp4"), 3600, { download: 'Kopi "susu".mp4' }));
  assert.equal(dl.searchParams.get("response-content-disposition"), 'attachment; filename="Kopi susu.mp4"');
  // uploads: a 15-minute PUT, and NO SDK checksum (an empty-body CRC32 would reject every real upload)
  const put = new URL(await presignPut(cfg, r2Key("studio-assets", "sprites/uco-angry-open.png")));
  assert.equal(put.searchParams.get("X-Amz-Expires"), "900");
  assert.equal(put.searchParams.get("x-id"), "PutObject");
  for (const k of put.searchParams.keys()) assert.doesNotMatch(k, /checksum/i, k);
  // lifetimes: never past S3's 7-day maximum, never under a minute
  assert.equal(clampExpiry(30 * 86400), 7 * 86400);
  assert.equal(clampExpiry(5), 60);
  assert.equal(PRESIGN.render, 6 * 3600);
  assert.match(read("src/lib/publish/adapters.ts"), /signedUrl\(p\.video\.storage_path, PRESIGN\.publish\)/);
});

const harness = (mode: "supabase" | "r2" | "r2broken") =>
  JSON.parse(
    execFileSync("npx", ["tsx", "--conditions=react-server", "--tsconfig", "tsconfig.json", "tests/unit/storage-fallback.harness.mts"], {
      cwd: ROOT,
      env: { ...process.env, MODE: mode, R2_ACCOUNT_ID: "", R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "", R2_BUCKET_NAME: "", R2_ENDPOINT: "", STORAGE_DRIVER: "" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .trim()
      .split("\n")
      .at(-1)!,
  );

test("without R2_*: everything stays on Supabase Storage exactly as before", () => {
  const r = harness("supabase");
  assert.equal(r.driver, "supabase");
  assert.match(r.newSigned, /\/storage\/v1\/object\/sign\/recordings\/new-episode\/line-01\.webm\?token=supa$/);
  assert.equal(r.newBytes, "new take");
  assert.equal(r.supabaseHasNewUpload, true, "the upload went to Supabase");
  assert.match(r.download, /&download=Episode%201\.webm$/, "Supabase's own download flag");
  assert.match(r.uploadUrl, /\/storage\/v1\/object\/upload\/sign\/studio-assets\//);
  assert.match(r.publicUrl, /\/storage\/v1\/object\/public\/custom-assets\/props\/sate\.png$/);
  assert.ok(!r.calls.some((c: string) => c.startsWith("r2 ")), "no R2 request at all");
});

test("with R2_*: new objects go to R2; an older object missing from R2 falls back to Supabase; deletes clear both", () => {
  const r = harness("r2");
  assert.equal(r.driver, "r2");
  // a new upload: stored in R2 under its prefix (base MIME type), read and signed from R2, never written to Supabase
  assert.ok(r.r2Keys.includes("recordings/new-episode/line-01.webm"));
  assert.equal(r.newObjectType, "audio/webm");
  assert.equal(r.supabaseHasNewUpload, false);
  assert.match(r.newSigned, /\/media\/recordings\/new-episode\/line-01\.webm\?X-Amz-Algorithm=AWS4-HMAC-SHA256/);
  assert.match(r.newSigned, /X-Amz-Expires=7200/);
  assert.equal(r.newBytes, "new take");
  assert.match(r.download, /response-content-disposition=attachment/);
  // an older take only in Supabase: signed and downloaded from Supabase, so existing episodes keep playing
  assert.match(r.oldSigned, /\/storage\/v1\/object\/sign\/recordings\/old-episode\/line-01\.webm\?token=supa$/);
  assert.equal(r.oldBytes, "old take");
  // browser uploads: a presigned R2 PUT that a real PUT (Content-Type + the old x-upsert header) goes through
  assert.match(r.uploadUrl, /\/media\/studio-assets\/sprites\/uco-angry-open\.png\?X-Amz-Algorithm/);
  assert.deepEqual(r.browserPut, { status: 200, stored: "browser upload" });
  // public assets: a permanent app URL that redirects to R2, or to Supabase for an asset not copied yet; never the
  // private recordings, never a path that climbs out
  assert.equal(r.publicUrl, "https://app.example/api/storage/custom-assets/props/sate.png");
  assert.match(r.redirectNew, /\/media\/studio-assets\/sprites\/uco-angry-open\.png\?X-Amz-Algorithm=.*X-Amz-Expires=21600/);
  assert.match(r.redirectOld, /\/storage\/v1\/object\/public\/studio-assets\/sprites\/uco-angry-closed\.png$/);
  assert.equal(r.redirectPrivate, null);
  assert.equal(r.redirectTraversal, null);
  // listings merge R2 with older Supabase files; a delete removes both copies (the fallback can't resurrect it)
  assert.deepEqual(r.list, ["uco-angry-closed.png", "uco-angry-open.png"]);
  assert.deepEqual(r.listAfterDelete, []);
  assert.equal(r.supabaseStillHasDeleted, false);
});

test("the /api/storage redirect route is public (like the old public buckets) and serves only the public areas", () => {
  assert.match(read("src/proxy.ts"), /\|api\/storage\/\|/);
  const route = read("src/app/api/storage/[bucket]/[...path]/route.ts");
  assert.match(route, /status: 302, headers: \{ Location: target, "Cache-Control": "private, max-age=300" \}/);
  assert.match(read("src/lib/storage.ts"), /export const PUBLIC_AREAS = \["studio-assets", "custom-assets"\] as const;/);
});

test("the one-time copy script: studio-assets + custom-assets by default, skips what R2 has, never deletes from Supabase", () => {
  const s = read("scripts/migrate-supabase-to-r2.ts");
  assert.match(s, /const buckets = picked\.length \? picked : \["studio-assets", "custom-assets"\];/);
  assert.match(s, /if \(have && \(f\.size == null \|\| have\.size === f\.size\)\) \{\s*skipped\+\+;/);
  assert.match(s, /--dry-run/);
  assert.doesNotMatch(s.replace(/^\s*\/\/.*$/gm, ""), /DELETE|r2Delete|deleteObjects|method: "DELETE"/, "never deletes anything");
  assert.match(read("package.json"), /"storage:migrate-r2": "tsx --env-file-if-exists=\.env\.local scripts\/migrate-supabase-to-r2\.ts"/);
});

test("render / autopilot workflows pass the four R2 secrets", () => {
  for (const f of [".github/workflows/render-worker.yml", ".github/workflows/autonomous-scheduler.yml"]) {
    const y = read(f);
    for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]) assert.match(y, new RegExp(`${k}: \\$\\{\\{ secrets\\.${k} \\}\\}`), `${f} ${k}`);
  }
});

test('episode videos keep <video preload="metadata"> (opening a page never pre-downloads the MP4); downloads are signed, never appended', () => {
  const page = read("src/app/create/[id]/page.tsx");
  const videos = page.match(/<video\b[^>]*>/g) ?? [];
  assert.ok(videos.length >= 1);
  for (const v of videos) assert.match(v, /preload="metadata"/, v);
  assert.match(page, /href=\{await videoDownloadUrl\(video\.storage_path, `\$\{project\.title \?\? "episode"\}\.mp4`\)\}/);
  assert.doesNotMatch(page, /\$\{video\.url\}&download=/, "appending to a presigned R2 URL would break its signature");
  const tsx = fs.readdirSync(path.join(ROOT, "src"), { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".tsx"));
  for (const f of tsx) {
    const s = read(`src/${f}`);
    for (const v of s.match(/<video\b[^>]*>/g) ?? []) assert.match(v, /preload="(metadata|none)"/, `${f}: ${v}`);
  }
});

test("hotfix: when R2 fails (e.g. a refused key pair) every read and write falls back to Supabase instead of failing", () => {
  const r = harness("r2broken");
  // the live check names the real error, sanitized
  assert.equal(r.health.configured, true);
  assert.equal(r.health.ok, false);
  assert.deepEqual([r.health.error.name, r.health.error.code, r.health.error.status], ["InvalidAccessKeyId", "InvalidAccessKeyId", 403]);
  assert.match(r.health.error.message, /^The AWS Access Key Id you provided does not exist in our records: <access-key-id>/);
  assert.doesNotMatch(JSON.stringify(r.health), /AKIDTEST|s3cr3t|0123456789abcdef/, "no key material in the health output");
  // after the failure, storage runs on Supabase (circuit breaker), and nothing failed for the caller
  assert.equal(r.driverAfter, "supabase");
  assert.equal(r.putLandedInSupabase, "saved anyway", "an upload during an R2 failure is kept in Supabase");
  assert.match(r.signedOld, /\/storage\/v1\/object\/sign\/recordings\/old-episode\/line-01\.webm/);
  assert.equal(r.bytesOld, "old take");
  assert.match(r.uploadUrl, /\/storage\/v1\/object\/upload\/sign\/studio-assets\//, "no upload URL R2 would refuse");
  assert.match(r.redirect, /\/storage\/v1\/object\/public\/studio-assets\/sprites\/uco-angry-closed\.png$/);
  assert.deepEqual(r.list, ["uco-angry-closed.png"]);
  // one refused R2 request trips the breaker; the rest go straight to Supabase
  assert.ok(r.calls.filter((c: string) => c.startsWith("r2 ")).length <= 2, r.calls.join(" | "));
});

test("hotfix: R2 errors are reported as name / code / status / message with credentials and long tokens scrubbed", () => {
  const cfg = r2Config(ENV)!;
  const e = Object.assign(new Error(`SignatureDoesNotMatch for AKIDTEST with s3cr3t at https://acct123.r2.cloudflarestorage.com sig=${"a1".repeat(32)}`), { name: "SignatureDoesNotMatch", Code: "SignatureDoesNotMatch", $metadata: { httpStatusCode: 403 } });
  const info = r2ErrorInfo(e, cfg);
  assert.deepEqual([info.name, info.code, info.status], ["SignatureDoesNotMatch", "SignatureDoesNotMatch", 403]);
  assert.doesNotMatch(info.message, /AKIDTEST|s3cr3t|acct123|a1a1a1/);
  assert.match(info.message, /<access-key-id> with <secret> at https:\/\/<account-id>\.r2\.cloudflarestorage\.com <redacted>$/);
  // the health route returns only that shape (and never the raw error)
  const health = read("src/app/api/health/route.ts");
  assert.match(health, /const r2 = await r2Health\(\)\.catch\(\(\) => \(\{ configured: true, ok: false, error: \{ name: "Error", code: null, status: null, message: "The R2 check itself failed; see the function log\." \} \}\)\);/);
  assert.match(read("src/lib/storage.ts"), /endpointHost: new URL\(cfg\.endpoint\)\.host\.replace\(cfg\.accountId, "<account-id>"\)/);
});
