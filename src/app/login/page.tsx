import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6">
        <div className="mb-5 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent font-bold text-accent-contrast">S</span>
          <div>
            <h1 className="font-semibold">Studio</h1>
            <p className="text-xs text-muted">Enter your password to continue</p>
          </div>
        </div>
        <Suspense fallback={<div className="h-24" />}>
          <NextField searchParams={props.searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function NextField({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  return <LoginForm next={next} />;
}
