import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Dapur Konten is a private, single-user content tool. It is operated by and for its owner to plan, edit, publish and
        analyze the owner&apos;s own social media content. It is not offered to the public.
      </p>
      <h2>What data we access</h2>
      <ul>
        <li>Basic profile information of the connected accounts (account ID, username, profile name).</li>
        <li>The connected accounts&apos; own posts and videos, and their performance metrics (views, likes, comments, shares, saves, watch time, follower counts).</li>
        <li>Media files and captions the owner uploads or creates in Dapur Konten.</li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>To show the owner which content performs well, and to generate content suggestions with AI (Anthropic&apos;s Claude API).</li>
        <li>To publish content to the owner&apos;s own accounts, only after the owner approves each post.</li>
        <li>We do not sell data, show ads, or share data with third parties beyond the service providers needed to run the app (hosting, database, AI processing).</li>
      </ul>
      <h2>Storage and security</h2>
      <ul>
        <li>Data is stored in a private, access-controlled database. Access tokens are encrypted.</li>
        <li>The app is password protected and only the owner can sign in.</li>
      </ul>
      <h2 id="data-deletion">Data deletion</h2>
      <p>
        You can disconnect any account at any time from the Accounts screen in Dapur Konten, or by removing the app&apos;s access
        in the platform&apos;s own settings (TikTok, Instagram, Facebook or Google account settings). On request to the
        contact below, all data from the connected account (tokens, posts and metrics) is permanently deleted within 30 days.
      </p>
    </LegalPage>
  );
}
