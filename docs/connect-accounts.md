# Connecting TikTok, Instagram, Facebook and YouTube Shorts

Three developer setups cover all four platforms:

| Setup | Covers | Where |
|---|---|---|
| A. TikTok for Developers | TikTok | developers.tiktok.com |
| B. Meta for Developers | Instagram + Facebook | developers.facebook.com |
| C. Google Cloud | YouTube Shorts | console.cloud.google.com |

Each one ends with a **Client ID** and a **Client Secret**. Put them in **Vercel → contentmaker → Environment Variables**
(same way as `APP_PASSWORD`, tick Production, mark Sensitive). **Never paste secrets in chat.**

Links you will be asked for:

| Field | Value |
|---|---|
| Website | `https://contentmaker-lime.vercel.app` |
| Privacy Policy | `https://contentmaker-lime.vercel.app/privacy` |
| Terms of Service | `https://contentmaker-lime.vercel.app/terms` |
| Data deletion instructions | `https://contentmaker-lime.vercel.app/privacy#data-deletion` |
| App icon (download, then upload) | `https://contentmaker-lime.vercel.app/icon-512.png` |

Redirect (callback) URLs:

| Platform | Redirect URL |
|---|---|
| TikTok | `https://contentmaker-lime.vercel.app/api/connect/tiktok/callback` |
| Instagram | `https://contentmaker-lime.vercel.app/api/connect/instagram/callback` |
| Facebook | `https://contentmaker-lime.vercel.app/api/connect/facebook/callback` |
| YouTube | `https://contentmaker-lime.vercel.app/api/connect/youtube/callback` |

Platform screens change often. If a button has a different name, look for the closest match or send a screenshot.

---

## Before you start (on your phone, ~5 min)

- **Instagram:** switch to a professional account: Instagram → Profile → ☰ → *Account type and tools* →
  *Switch to professional account* → **Creator** (or Business). Free; you keep your followers.
- **Facebook:** you need a **Facebook Page** for your content (apps cannot post to a personal profile).
  If you don't have one: Facebook → ☰ → *Pages* → *Create*.
- **YouTube:** you need a YouTube **channel** on the Google account you'll use.
- **TikTok:** your normal account is fine.

---

## A. TikTok (do this first, since its review takes longest)

1. Go to **developers.tiktok.com** → **Log in** with your TikTok account → accept the developer terms.
2. Top right: **Manage apps** → **Connect an app** (or **Create app**). If asked, choose **Individual**.
3. **App details**
   - App name: `Studio Content` (TikTok rejects names containing "TikTok")
   - Icon: upload `icon-512.png` (link above)
   - Category: *Productivity* / *Utilities*
   - Description: `Personal tool to plan, edit, publish and analyze my own TikTok videos.`
   - Terms of Service URL and Privacy Policy URL: links above
   - Platforms: **Web**, website URL: link above
   - If it asks you to **verify the URL / domain** with a file: download the file and send it to Claude in chat
     (it's not a secret). Claude adds it to the site.
4. **Add products:** **Login Kit**, **Content Posting API** (turn on *Direct Post* if offered), and **Display API**
   (some layouts don't list Display API separately; then its scopes appear under Login Kit).
5. **Login Kit → Redirect URI:** the TikTok redirect URL above.
6. **Scopes:** tick `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`, `video.upload`, `video.publish`.
7. **Sandbox** (lets you test without review): open the **Sandbox** tab → *Create sandbox* → **Target users** →
   add your own TikTok account.
8. Copy the **Client key** and **Client secret** (the sandbox has its own pair, so use those for now) into Vercel:
   - `TIKTOK_CLIENT_KEY`
   - `TIKTOK_CLIENT_SECRET`
9. **Don't submit for review yet.** TikTok wants a demo video of the working app. We'll record it once Claude has
   built the connection.

> Until TikTok approves the app, videos it posts are **private (only you)**. Analytics work right away.

---

## B. Meta: Instagram + Facebook

1. Go to **developers.facebook.com** → **Get started** → register as a developer with your Facebook account.
2. **My Apps → Create app.**
   - App name: `Studio Content`, contact email: yours.
   - **Use cases:** pick **"Manage messaging & content on Instagram"** and **"Manage everything on your Page"**
     (if asked for an app type instead, choose **Business**).
   - Business portfolio: skip / "I don't want to connect" is fine.
3. **App settings → Basic:**
   - Privacy Policy URL, Terms of Service URL, User data deletion → *Data deletion instructions URL*: links above
   - App icon: upload `icon-512.png`; Category: *Business and pages*
   - **Save changes.** Copy **App ID** and **App secret** (click *Show*) into Vercel:
     - `META_APP_ID`
     - `META_APP_SECRET`
4. **Instagram** (Use cases → *Manage messaging & content on Instagram* → *Customize* →
   **API setup with Instagram login**):
   - **Add account / Generate token** → log in with your Instagram professional account.
     If it asks you to add yourself as an **Instagram tester**: *App roles → Roles → Add people → Instagram tester*,
     then accept in Instagram: *Settings → Website permissions → Apps and websites → Tester invites*.
   - **Set up Instagram business login → Business login settings → OAuth redirect URIs:** the Instagram redirect URL above. Save.
   - This section shows its own **Instagram app ID** and **Instagram app secret**. Copy them into Vercel:
     - `INSTAGRAM_APP_ID`
     - `INSTAGRAM_APP_SECRET`
5. **Facebook Page** (Use cases → *Manage everything on your Page* → *Customize*):
   - Make sure these permissions are added: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights`.
   - **Facebook Login for Business → Settings → Valid OAuth Redirect URIs:** the Facebook redirect URL above. Save.
6. **Leave the app in Development mode.** You're its admin, so it already works with your own Instagram and Page.
   No business verification or app review is needed for personal use.

---

## C. Google: YouTube Shorts

1. Go to **console.cloud.google.com** with the Google account that owns your YouTube channel.
2. Top bar project picker → **New project** → name `contentmaker` → **Create**, then select it.
3. **APIs & Services → Library:** search and **Enable** both **YouTube Data API v3** and **YouTube Analytics API**.
4. **Google Auth Platform** (or *APIs & Services → OAuth consent screen*) → **Get started:**
   - App name `Studio Content`, support email: yours → Audience: **External** → contact email → Create.
   - **Branding:** home page, privacy policy and terms links above.
   - **Audience → Test users → Add users:** your own Gmail.
   - Then **Audience → Publish app → Confirm** (status "In production"). Otherwise Google logs the app out every
     7 days. You'll see an "unverified app" warning when you connect; click *Advanced → Go to Studio Content*.
     That's expected for a personal app.
5. **Clients** (or *Credentials*) → **Create client / Create credentials → OAuth client ID:**
   - Application type: **Web application**, name `contentmaker web`
   - **Authorized redirect URIs → Add URI:** the YouTube redirect URL above → **Create**.
   - Copy **Client ID** and **Client secret** into Vercel:
     - `GOOGLE_CLIENT_ID`
     - `GOOGLE_CLIENT_SECRET`

> Until the app passes YouTube's free API audit, Shorts uploaded through the API are **private**. Studio
> uploads them, and you switch them to Public in the YouTube Studio app (one tap). We can apply for the audit later.

---

## Checklist: Vercel variables when everything is done

`TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `META_APP_ID`, `META_APP_SECRET`, `INSTAGRAM_APP_ID`,
`INSTAGRAM_APP_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
Then tell Claude, who redeploys and adds a **Connect** button for each platform on the Accounts screen.
