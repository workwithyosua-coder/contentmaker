import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        Dapur Konten is a private content tool used only by its owner to manage the owner&apos;s own social media accounts.
        By connecting an account, the owner authorizes Dapur Konten to read that account&apos;s content and performance data and
        to publish content to it after the owner&apos;s approval.
      </p>
      <h2>Use</h2>
      <ul>
        <li>Dapur Konten may only be used with accounts the user owns or is authorized to manage.</li>
        <li>Users remain responsible for the content they publish and must follow each platform&apos;s own terms and community guidelines.</li>
        <li>AI-generated suggestions may be inaccurate; the user reviews and approves every post before it is published.</li>
      </ul>
      <h2>Availability</h2>
      <p>Dapur Konten is provided as-is, without warranties. Features may change or be discontinued at any time.</p>
      <h2>Disconnecting</h2>
      <p>Access can be revoked at any time from Dapur Konten&apos;s Accounts screen or from the platform&apos;s own settings. See the Privacy Policy for data deletion.</p>
    </LegalPage>
  );
}
