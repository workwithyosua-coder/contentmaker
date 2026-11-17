import "server-only";
import { decrypt, encrypt } from "./crypto";
import { db } from "./db";
import { refreshGoogleToken, type GoogleToken } from "./platforms/youtube";
import { getObject } from "./storage";

// Google Drive as the long-term home for finished episode videos.
// Scope drive.file: the app can only see files and folders it created itself, nothing else in the Drive.
export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";

export type DriveConnection = { email: string | null; folder_id: string | null };

export async function getDriveConnection(userId: string): Promise<DriveConnection | null> {
  const [row] = await db()<DriveConnection[]>`SELECT email, folder_id FROM drive_connections WHERE user_id = ${userId}`;
  return row ?? null;
}

async function gdrive<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, cache: "no-store" });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as T & { error?: { message?: string } }) : ({} as T & { error?: { message?: string } });
  if (!res.ok || json.error) {
    const msg = json.error?.message ?? `HTTP ${res.status}`;
    if (/has not been used|is disabled/i.test(msg)) throw new Error("The Google Drive API isn't enabled in your Google Cloud project yet.");
    throw new Error(`Google Drive: ${msg}`);
  }
  return json;
}

/** After the owner approves Drive access: remember the account and create the episodes folder. */
export async function saveDriveConnection(userId: string, token: GoogleToken) {
  if (!token.refresh_token) throw new Error("Google didn't return a refresh token. Remove the app's access in your Google account, then connect again.");
  const about = await gdrive<{ user?: { emailAddress?: string } }>(`${API}/about?fields=user(emailAddress)`, token.access_token);
  const folderId = await createFolders(token.access_token);
  await db()`
    INSERT INTO drive_connections (user_id, email, refresh_token_enc, folder_id)
    VALUES (${userId}, ${about.user?.emailAddress ?? null}, ${encrypt(token.refresh_token)}, ${folderId})
    ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, refresh_token_enc = EXCLUDED.refresh_token_enc,
      folder_id = EXCLUDED.folder_id, updated_at = now()`;
  return about.user?.emailAddress ?? null;
}

export async function disconnectDrive(userId: string) {
  await db()`DELETE FROM drive_connections WHERE user_id = ${userId}`;
}

async function createFolder(token: string, name: string, parent?: string) {
  const f = await gdrive<{ id: string }>(`${API}/files?fields=id`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
  });
  return f.id;
}

/** "Uco Ocu / Episodes" in the owner's Drive. */
async function createFolders(token: string) {
  return createFolder(token, "Episodes", await createFolder(token, "Uco Ocu"));
}

/** A fresh access token plus a folder that still exists (re-created if the owner deleted it). */
async function session(userId: string) {
  const [row] = await db()<{ refresh_token_enc: Buffer; folder_id: string | null }[]>`
    SELECT refresh_token_enc, folder_id FROM drive_connections WHERE user_id = ${userId}`;
  if (!row) return null;
  let token: string;
  try {
    token = (await refreshGoogleToken(decrypt(row.refresh_token_enc))).access_token;
  } catch {
    throw new Error("Google Drive access expired or was removed. Reconnect Google Drive on the Accounts page.");
  }
  let folder = row.folder_id;
  if (folder) {
    const f = await gdrive<{ trashed?: boolean }>(`${API}/files/${folder}?fields=id,trashed`, token).catch(() => null);
    if (!f || f.trashed) folder = null;
  }
  if (!folder) {
    folder = await createFolders(token);
    await db()`UPDATE drive_connections SET folder_id = ${folder}, updated_at = now() WHERE user_id = ${userId}`;
  }
  return { token, folder };
}

/**
 * Copies one rendered video from app storage into the Drive folder and records the link.
 * Returns false when Drive isn't connected. Errors are stored on the video and re-thrown.
 */
export async function copyVideoToDrive(videoId: string): Promise<boolean> {
  const sql = db();
  const [v] = await sql<{ storage_path: string; title: string | null; version: number; created_at: Date; user_id: string }[]>`
    SELECT ev.storage_path, p.title, s.version, ev.created_at, p.user_id
    FROM episode_videos ev JOIN content_projects p ON p.id = ev.project_id JOIN scripts s ON s.id = ev.script_id
    WHERE ev.id = ${videoId}`;
  if (!v) throw new Error("Video not found.");
  try {
    const s = await session(v.user_id);
    if (!s) return false;
    const bytes = await getObject(v.storage_path);
    if (!bytes) throw new Error("The video file is missing from app storage.");
    const name = `${(v.title ?? "Episode").replace(/[\\/:*?"<>|]/g, "-")} (v${v.version}, ${v.created_at.toISOString().slice(0, 10)}).mp4`;

    // Resumable upload: start a session, then send the whole file in one PUT (server to server, no size cap here).
    const start = await fetch(`${UPLOAD}/files?uploadType=resumable&fields=id,webViewLink`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${s.token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(bytes.byteLength),
      },
      body: JSON.stringify({ name, mimeType: "video/mp4", parents: [s.folder] }),
    });
    const location = start.headers.get("location");
    if (!start.ok || !location) {
      const msg = (await start.text()).slice(0, 300);
      if (/has not been used|is disabled/i.test(msg)) throw new Error("The Google Drive API isn't enabled in your Google Cloud project yet.");
      throw new Error(`Google Drive upload didn't start (${start.status}): ${msg}`);
    }
    const file = await gdrive<{ id: string; webViewLink?: string }>(location, s.token, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4" },
      body: new Uint8Array(bytes),
    });
    await sql`UPDATE episode_videos SET drive_file_id = ${file.id}, drive_url = ${file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`}, drive_error = NULL WHERE id = ${videoId}`;
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`UPDATE episode_videos SET drive_error = ${message} WHERE id = ${videoId}`;
    throw err;
  }
}
