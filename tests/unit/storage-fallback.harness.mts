// Harness for tests/unit/r2-storage.test.mts (run with --conditions=react-server, since storage.ts is server-only).
// Starts a fake S3 (R2) and a fake Supabase Storage on one local server, drives the real storage.ts through every
// mode, and prints one JSON report. MODE=supabase: no R2 env; MODE=r2: R2 configured (with the Supabase fallback).
import http from "node:http";
import type { AddressInfo } from "node:net";

const r2Objects = new Map<string, { body: Buffer; type: string; mtime: Date }>();
const supa = new Map<string, Buffer>([
  ["recordings/old-episode/line-01.webm", Buffer.from("old take")],
  ["studio-assets/sprites/uco-angry-closed.png", Buffer.from("old sprite")],
  ["custom-assets/props/sate.png", Buffer.from("old sate")],
]);
const calls: string[] = [];

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const u = new URL(req.url!, "http://x");
    const body = Buffer.concat(chunks);
    // ---- fake Supabase Storage
    if (u.pathname.startsWith("/storage/v1/")) {
      calls.push(`supabase ${req.method} ${u.pathname}`);
      const upSign = /^\/storage\/v1\/object\/upload\/sign\/([^/]+)\/(.+)$/.exec(u.pathname);
      if (upSign) return res.writeHead(200).end(JSON.stringify({ url: `/object/upload/sign/${upSign[1]}/${upSign[2]}?token=up` }));
      const sign = /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/.exec(u.pathname);
      if (sign) return res.writeHead(200).end(JSON.stringify({ signedURL: `/object/sign/${sign[1]}/${sign[2]}?token=supa` }));
      const auth = /^\/storage\/v1\/object\/authenticated\/([^/]+)\/(.+)$/.exec(u.pathname);
      if (auth) {
        const b = supa.get(`${auth[1]}/${auth[2]}`);
        return b ? res.writeHead(200).end(b) : res.writeHead(404).end("{}");
      }
      const list = /^\/storage\/v1\/object\/list\/([^/]+)$/.exec(u.pathname);
      if (list) {
        const prefix = (JSON.parse(body.toString() || "{}").prefix as string) + "/";
        const rows = [...supa.keys()].filter((k) => k.startsWith(`${list[1]}/${prefix}`)).map((k) => ({ name: k.slice(list[1].length + 1 + prefix.length), id: "x", updated_at: "2026-11-01T00:00:00Z", metadata: { size: supa.get(k)!.length } }));
        return res.writeHead(200).end(JSON.stringify(rows));
      }
      const del = /^\/storage\/v1\/object\/([^/]+)$/.exec(u.pathname);
      if (del && req.method === "DELETE") {
        for (const p of JSON.parse(body.toString()).prefixes as string[]) supa.delete(`${del[1]}/${p}`);
        return res.writeHead(200).end("[]");
      }
      const put = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(u.pathname);
      if (put && req.method === "POST") {
        supa.set(`${put[1]}/${put[2]}`, body);
        return res.writeHead(200).end("{}");
      }
      return res.writeHead(404).end("{}");
    }
    // ---- fake S3 (path style: /<bucket>/<key>)
    const [, bucket, ...rest] = u.pathname.split("/");
    if (process.env.MODE === "r2broken") {
      // a bad key pair: R2 refuses everything, echoing the access key id like S3 does
      calls.push(`r2 ${req.method} refused`);
      const xml = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidAccessKeyId</Code><Message>The AWS Access Key Id you provided does not exist in our records: AKIDTEST (secret s3cr3t-very-long-signing-key-0123456789abcdef)</Message></Error>`;
      return res.writeHead(403, { "Content-Type": "application/xml" }).end(req.method === "HEAD" ? undefined : xml);
    }
    const key = decodeURIComponent(rest.join("/"));
    calls.push(`r2 ${req.method} ${key || "?" + u.searchParams.toString()}`);
    if (bucket !== "media") return res.writeHead(404).end();
    if (req.method === "PUT" && key) {
      r2Objects.set(key, { body, type: String(req.headers["content-type"] ?? ""), mtime: new Date("2026-11-28T00:00:00Z") });
      return res.writeHead(200, { ETag: '"1"' }).end();
    }
    if ((req.method === "GET" || req.method === "HEAD") && key) {
      const o = r2Objects.get(key);
      if (!o) return res.writeHead(404, { "Content-Type": "application/xml" }).end(req.method === "HEAD" ? undefined : "<Error><Code>NoSuchKey</Code></Error>");
      res.writeHead(200, { "Content-Type": o.type, "Content-Length": o.body.length, "Last-Modified": o.mtime.toUTCString(), ETag: '"1"' });
      return res.end(req.method === "HEAD" ? undefined : o.body);
    }
    if (req.method === "GET" && u.searchParams.get("list-type") === "2") {
      const prefix = u.searchParams.get("prefix") ?? "";
      const items = [...r2Objects.entries()].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"));
      const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>media</Name><Prefix>${prefix}</Prefix><KeyCount>${items.length}</KeyCount><IsTruncated>false</IsTruncated>${items.map(([k, o]) => `<Contents><Key>${k}</Key><LastModified>${o.mtime.toISOString()}</LastModified><Size>${o.body.length}</Size></Contents>`).join("")}</ListBucketResult>`;
      return res.writeHead(200, { "Content-Type": "application/xml" }).end(xml);
    }
    if (req.method === "POST" && u.searchParams.has("delete")) {
      for (const m of body.toString().matchAll(/<Key>([^<]+)<\/Key>/g)) r2Objects.delete(m[1]);
      return res.writeHead(200, { "Content-Type": "application/xml" }).end('<?xml version="1.0"?><DeleteResult></DeleteResult>');
    }
    res.writeHead(400).end();
  });
});

await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const mode = process.env.MODE;
Object.assign(process.env, { SUPABASE_URL: base, SUPABASE_SECRET_KEY: "supa-secret", STORAGE_DRIVER: "" });
if (mode === "r2" || mode === "r2broken") Object.assign(process.env, { R2_ACCOUNT_ID: "acct123", R2_ACCESS_KEY_ID: "AKIDTEST", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET_NAME: "media", R2_ENDPOINT: base });

const S = await import("../../src/lib/storage.ts");
if (mode === "r2broken") {
  // every call must still work (through Supabase), and the health check must show the real, sanitized error
  const health = await S.r2Health();
  await S.putObject("broken/line-01.webm", new TextEncoder().encode("saved anyway").buffer, "audio/webm");
  const report = {
    health,
    driverAfter: S.storageDriver(),
    putLandedInSupabase: supa.get("recordings/broken/line-01.webm")?.toString() ?? null,
    signedOld: await S.signedUrl("old-episode/line-01.webm"),
    bytesOld: Buffer.from((await S.getObject("old-episode/line-01.webm"))!).toString(),
    uploadUrl: await S.signedUploadUrl("sprites/uco-angry-open.png", "studio-assets", true),
    redirect: await S.publicRedirect("studio-assets", "sprites/uco-angry-closed.png"),
    list: (await S.listObjectInfo("sprites", "studio-assets")).map((o) => o.name),
    calls,
  };
  console.log(JSON.stringify(report));
  server.close();
  process.exit(0);
}
const out: Record<string, unknown> = { driver: S.storageDriver() };
const text = (b: ArrayBuffer | null) => (b ? Buffer.from(b).toString() : null);

// a new upload, and reading it back
await S.putObject("new-episode/line-01.webm", new TextEncoder().encode("new take").buffer, "audio/webm;codecs=opus");
out.newSigned = await S.signedUrl("new-episode/line-01.webm", 7200);
out.newBytes = text(await S.getObject("new-episode/line-01.webm"));
// an older object that is only in Supabase
out.oldSigned = await S.signedUrl("old-episode/line-01.webm", 3600);
out.oldBytes = text(await S.getObject("old-episode/line-01.webm"));
out.download = await S.signedUrl("new-episode/line-01.webm", 3600, { download: "Episode 1.webm" });
out.uploadUrl = await S.signedUploadUrl("sprites/uco-angry-open.png", "studio-assets", true);
// public assets: the permanent URL, and where it redirects
out.publicUrl = S.publicObjectUrl("props/sate.png", "custom-assets", "https://app.example");
if (mode === "r2") {
  await S.putObject("x", new ArrayBuffer(1), "text/plain"); // (recordings area; keeps the R2 client warm)
  // a studio asset copied to R2 vs one still only in Supabase
  const { r2Put, r2Config } = await import("../../src/lib/r2.ts");
  await r2Put(r2Config()!, "studio-assets/sprites/uco-angry-open.png", new TextEncoder().encode("new sprite"), "image/png");
  // the browser's upload: a PUT with its own Content-Type (and the old x-upsert header) to the presigned URL
  const put = await fetch(String(out.uploadUrl), { method: "PUT", headers: { "Content-Type": "image/png", "x-upsert": "true" }, body: "browser upload" });
  out.browserPut = { status: put.status, stored: r2Objects.get("studio-assets/sprites/uco-angry-open.png")?.body.toString() ?? null };
  out.redirectNew = await S.publicRedirect("studio-assets", "sprites/uco-angry-open.png");
  out.redirectOld = await S.publicRedirect("studio-assets", "sprites/uco-angry-closed.png");
  out.redirectPrivate = await S.publicRedirect("recordings", "new-episode/line-01.webm");
  out.redirectTraversal = await S.publicRedirect("studio-assets", "../recordings/new-episode/line-01.webm");
  out.list = (await S.listObjectInfo("sprites", "studio-assets")).map((o) => o.name);
  await S.deleteObjects(["sprites/uco-angry-closed.png", "sprites/uco-angry-open.png"], "studio-assets");
  out.listAfterDelete = (await S.listObjectInfo("sprites", "studio-assets")).map((o) => o.name);
  out.supabaseStillHasDeleted = supa.has("studio-assets/sprites/uco-angry-closed.png");
  out.r2Keys = [...r2Objects.keys()].sort();
  out.newObjectType = r2Objects.get("recordings/new-episode/line-01.webm")?.type ?? null;
}
out.supabaseHasNewUpload = supa.has("recordings/new-episode/line-01.webm");
out.calls = calls;
console.log(JSON.stringify(out));
server.close();
process.exit(0);
