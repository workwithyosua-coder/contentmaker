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
| Data deletion instructions | `https://contentmaker-lime.vercel.app/data-deletion` |
| App icon (download, then upload) | `https://contentmaker-lime.vercel.app/icon-512.png` |

Redirect (callback) URLs:

| Platform | Redirect URL |
|---|---|
| TikTok | `https://contentmaker-lime.vercel.app/api/connect/tiktok/callback` |
| Instagram + Facebook | `https://contentmaker-lime.vercel.app/api/connect/meta/callback` |
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

## B. Meta: Instagram + Facebook (one Facebook login covers both)

Prerequisites: Instagram is a **professional** (Creator/Business) account and is **linked to your Facebook Page**
(Facebook Page → Settings → Linked accounts → Instagram).

1. **developers.facebook.com** → **Get started** → register as a developer.
2. **My Apps → Create app** → name `Studio Content` → use cases (filter **All**): tick
   **Manage messaging & content on Instagram** and **Manage everything on your Page**. Skip the business portfolio.
3. **App settings → Basic:** Privacy Policy, Terms, and *Data deletion instructions URL*
   (`https://contentmaker-lime.vercel.app/data-deletion`, no `#` allowed), icon, category, app domain
   `contentmaker-lime.vercel.app`. Leave the GDPR/DPO section empty. Save.
4. **Use cases → Instagram API → API setup with Facebook login** (not "Unified login", which needs a business
   portfolio) → **Add required content permissions**. Skip the messaging permissions.
5. **Permissions and features:** make sure these say *Ready for testing*: `instagram_basic`,
   `instagram_manage_insights`, `instagram_content_publish`, `business_management`, `pages_show_list`,
   `pages_read_engagement`; under the Page use case also `read_insights` and `pages_manage_posts`.
   Don't add the `instagram_business_*` ones (they belong to Unified login).
6. **Facebook Login for Business → Settings:** Client OAuth login, Web OAuth login and Enforce HTTPS = Yes;
   **Valid OAuth Redirect URIs:** `https://contentmaker-lime.vercel.app/api/connect/meta/callback`. Save.
7. **Facebook Login for Business → Configurations → Create configuration:** name `Studio`, *User access token*
   (expiration: Never), assets **Pages** + **Instagram accounts**, the 8 permissions from step 5.
8. Vercel variables: `META_APP_ID`, `META_APP_SECRET` (Sensitive), `META_LOGIN_CONFIG_ID` (the configuration ID).
9. Leave the app **Unpublished** (Development mode): it works for your own accounts without app review.
10. In Studio: **Accounts → Connect via Facebook** → select your Page **and** its Instagram account in the dialog.

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

`TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
Then tell Claude, who redeploys and adds a **Connect** button for each platform on the Accounts screen.
