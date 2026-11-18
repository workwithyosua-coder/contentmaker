// Platform-specific publishing metadata written by the Copywriter at "Approve script & write captions",
// stored on content_projects.platform_captions, and turned into each platform's final text here.
// No server-only imports: the publish panel formats previews with the same functions.

export type PlatformCaptions = {
  youtube: { title: string; description: string; tags: string[] };
  tiktok: { caption: string; hashtags: string[] };
  instagram: { hook: string; context: string; comment_prompt: string; hashtags: string[] };
  facebook: { title: string; description: string };
};

export type PublishPlatform = "youtube" | "tiktok" | "instagram" | "facebook";
export const PUBLISH_PLATFORMS: PublishPlatform[] = ["tiktok", "instagram", "youtube", "facebook"];

const tags = (h: string[]) => h.map((t) => `#${t.replace(/^#/, "").replace(/\s+/g, "")}`).join(" ");
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** YouTube title: ≤ 100 characters (API limit), always ending in #Shorts. */
export function youtubeTitle(c: PlatformCaptions["youtube"]) {
  const base = c.title.replace(/#shorts/gi, "").trim();
  return `${clip(base, 90)} #Shorts`;
}

/** The text each platform receives (before any manual edit in the publish panel). */
export function defaultText(platform: PublishPlatform, c: PlatformCaptions): { title?: string; text: string } {
  switch (platform) {
    case "youtube":
      return { title: youtubeTitle(c.youtube), text: clip(`${c.youtube.description}\n\n#Shorts`, 5000) };
    case "tiktok":
      return { text: clip(`${c.tiktok.caption}\n\n${tags(c.tiktok.hashtags)}`, 2200) };
    case "instagram":
      return { text: clip(`${c.instagram.hook}\n\n${c.instagram.context}\n\n${c.instagram.comment_prompt}\n\n${tags(c.instagram.hashtags)}`, 2200) };
    case "facebook":
      return { title: clip(c.facebook.title, 255), text: clip(c.facebook.description, 5000) };
  }
}
