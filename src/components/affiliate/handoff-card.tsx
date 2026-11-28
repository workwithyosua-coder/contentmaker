"use client";

import { useEffect, useRef, useState } from "react";

/** The pinned comment, copied with live "Copied" feedback (and a fallback message when the clipboard is blocked). */
export function CopyPinnedComment({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2500);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-outline" onClick={copy} data-copy-pinned>
        {state === "copied" ? "Copied" : "Copy pinned comment"}
      </button>
      <span aria-live="polite" className="text-sm" style={{ color: state === "failed" ? "var(--bad)" : "var(--win)" }} data-copy-status>
        {state === "copied" ? "Pinned comment copied." : state === "failed" ? "Copy blocked by the browser: select the text above instead." : ""}
      </span>
    </div>
  );
}
