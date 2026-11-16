import type { ReactNode } from "react";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const contact = process.env.CONTACT_EMAIL;
  return (
    <article className="mx-auto max-w-2xl space-y-4 py-4 text-sm leading-relaxed [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted">Last updated: 16 November 2026</p>
      {children}
      <h2>Contact</h2>
      <p>
        Questions or requests: {contact ? <a className="text-accent underline" href={`mailto:${contact}`}>{contact}</a> : "contact the owner of this app"}.
      </p>
    </article>
  );
}
