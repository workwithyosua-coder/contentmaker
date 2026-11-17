import { EmptyState } from "./ui";

export function SetupNotice({ error }: { error?: string }) {
  return (
    <EmptyState title="Almost there: connect the database">
      <p>
        {error ? <>The app couldn&apos;t load data: <code className="text-xs">{error}</code>. </> : null}
        Set <code>DATABASE_URL</code> in <code>.env.local</code>, then run <code>npm run db:setup</code> and{" "}
        <code>npm run db:seed</code> to load demo data.
      </p>
    </EmptyState>
  );
}
