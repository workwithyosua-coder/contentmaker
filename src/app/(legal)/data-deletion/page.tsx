import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Data Deletion · Studio" };

export default function DataDeletionPage() {
  return (
    <LegalPage title="Data Deletion Instructions">
      <p>
        Studio is a private tool that only stores data from social accounts its owner connects. You can remove that data
        at any time in any of these ways:
      </p>
      <h2>1. Disconnect inside Studio</h2>
      <p>Open Studio → Accounts, and disconnect the account. Its access tokens are deleted immediately.</p>
      <h2>2. Remove access on the platform</h2>
      <ul>
        <li><b>Facebook:</b> Settings &amp; privacy → Settings → Apps and websites → remove “Studio Content”.</li>
        <li><b>Instagram:</b> Settings → Website permissions → Apps and websites → remove “Studio Content”.</li>
        <li><b>TikTok:</b> Settings and privacy → Security → Apps and services permissions → remove the app.</li>
        <li><b>YouTube / Google:</b> myaccount.google.com/permissions → remove “Studio Content”.</li>
      </ul>
      <h2>3. Request full deletion</h2>
      <p>
        Contact us using the details below and ask for deletion. All data from the connected account (tokens, posts,
        metrics and generated insights) is permanently deleted within 30 days, and we confirm when it is done.
      </p>
    </LegalPage>
  );
}
