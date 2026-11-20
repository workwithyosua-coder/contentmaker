// Captions without AI: editable default titles and captions for every platform, built from the episode title and its
// opening line by fixed rules, plus the checks the publish panel and the publish action share.
// Pure code (no server-only or AI imports), so the browser and the server run the same functions.

import type { PlatformCaptions, PublishPlatform } from "./captions";

/** Character limits each platform's API accepts. The YouTube title includes the " #Shorts" ending. */
export const CAPTION_LIMITS: Record<PublishPlatform, { title?: number; text: number }> = {
  tiktok: { text: 2200 },
  instagram: { text: 2200 },
  youtube: { title: 100, text: 5000 },
  facebook: { title: 255, text: 5000 },
};

/** Which fields a platform must have before it can be posted (YouTube needs a title, the rest need a caption). */
export const REQUIRED: Record<PublishPlatform, { title: boolean; text: boolean }> = {
  tiktok: { title: false, text: true },
  instagram: { title: false, text: true },
  youtube: { title: true, text: false },
  facebook: { title: false, text: true },
};

const BASE_TAGS = ["UcoOcu", "komedi", "edukasi"];
const COMMENT_PROMPT = "Tim Uco atau Tim Ocu? Tulis di komentar.";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** Cuts at a word boundary so the result is at most `max` characters, adding "…" when it cut. */
export function clipWords(s: string, max: number): string {
  const t = oneLine(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, "")}…`;
}

/** One hashtag from the episode title ("Mie Pedas Level 10" → "MiePedasLevel10"), or null when nothing usable. */
function titleTag(title: string): string | null {
  const tag = oneLine(title)
    .split(" ")
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .slice(0, 4)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
  return tag.length >= 3 && tag.length <= 40 ? tag : null;
}

/**
 * Default captions for every platform from the episode title and (when there is one) its opening line as the hook.
 * Same input, same output. The user edits them in the publish panel before posting.
 */
export function manualCaptions(p: { title: string; hook?: string | null }): PlatformCaptions {
  const title = oneLine(p.title) || "Uco & Ocu";
  const hook = p.hook ? clipWords(p.hook.replace(/^["“”']+|["“”']+$/g, ""), 150) : "";
  const tag = titleTag(title);
  const tags = tag ? [tag, ...BASE_TAGS] : BASE_TAGS;
  const lead = hook && hook.toLowerCase() !== title.toLowerCase() ? `${title}\n\n${hook}` : title;
  return {
    // youtubeTitle() adds " #Shorts": 90 characters here keeps the final title within YouTube's 100
    youtube: { title: clipWords(title, 90), description: `${lead}\n\n${COMMENT_PROMPT}`, tags: tags.map((t) => t.toLowerCase()) },
    tiktok: { caption: hook ? `${title}: ${hook}` : title, hashtags: [...tags, "fyp"] },
    instagram: { hook: title, context: hook, comment_prompt: COMMENT_PROMPT, hashtags: tags },
    facebook: { title: clipWords(title, 255), description: `${lead}\n\n${COMMENT_PROMPT}` },
  };
}

/** The opening spoken line of a script, used as the caption hook. */
export function hookLine(lines: { text?: string | null }[] | null | undefined): string | null {
  const first = (lines ?? []).map((l) => oneLine(l.text ?? "")).find(Boolean);
  return first ?? null;
}

export type CaptionFields = { title?: string; text?: string };
export type CaptionProblem = { platform: PublishPlatform; field: "title" | "text"; message: string };

const LABEL: Record<PublishPlatform, string> = { tiktok: "TikTok", instagram: "Instagram Reels", youtube: "YouTube Shorts", facebook: "Facebook Reels" };

/** Blank required fields and over-limit text on the platforms that are switched on. Empty list = ready to post. */
export function captionProblems(fields: Partial<Record<PublishPlatform, CaptionFields & { enabled?: boolean }>>): CaptionProblem[] {
  const out: CaptionProblem[] = [];
  for (const [platform, f] of Object.entries(fields) as [PublishPlatform, CaptionFields & { enabled?: boolean }][]) {
    if (!f || !f.enabled) continue;
    const req = REQUIRED[platform];
    const lim = CAPTION_LIMITS[platform];
    const title = (f.title ?? "").trim();
    const text = (f.text ?? "").trim();
    const textName = platform === "youtube" || platform === "facebook" ? "description" : "caption";
    if (req.title && !title) out.push({ platform, field: "title", message: `${LABEL[platform]}: write a title.` });
    if (req.text && !text) out.push({ platform, field: "text", message: `${LABEL[platform]}: write a ${textName}.` });
    if (lim.title && title.length > lim.title) out.push({ platform, field: "title", message: `${LABEL[platform]}: the title is over ${lim.title} characters.` });
    if (text.length > lim.text) out.push({ platform, field: "text", message: `${LABEL[platform]}: the ${textName} is over ${lim.text} characters.` });
  }
  return out;
}

/** Statuses an approval moves forward from; a later step (recorded, rendering, published…) is never moved back. */
const BEFORE_APPROVAL = new Set(["draft", "scripting", "awaiting_script_approval", "captioning"]);

/**
 * The episode status after a script approval (with or without AI captions): straight to "recorded" when every line is
 * already recorded, else "awaiting_recording"; anything already past approval keeps its status.
 */
export function statusAfterApproval(current: string, progress: { lines: number; recorded: number }): string {
  if (!BEFORE_APPROVAL.has(current)) return current;
  return progress.lines > 0 && progress.recorded >= progress.lines ? "recorded" : "awaiting_recording";
}
