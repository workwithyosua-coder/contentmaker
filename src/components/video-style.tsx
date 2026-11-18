"use client";

import { useState, useTransition } from "react";
import type { StepResult } from "@/app/create/actions";
import { VIDEO_STYLES, styleById } from "../../video/src/styles/registry";

/** Per-episode video style; the preview, shot prompts, Render video and the renderer all use it. Native radios, so
 * arrow keys move between styles and Tab leaves the group. */
export function VideoStylePicker({ value, action }: { value: string; action: (style: string) => Promise<StepResult> }) {
  const [style, setStyle] = useState(styleById(value).id);
  const [pending, start] = useTransition();
  return (
    <fieldset className="space-y-2">
      <legend className="label">Video style</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {VIDEO_STYLES.map((s) => {
          const on = style === s.id;
          return (
            <label
              key={s.id}
              className={`flex min-h-11 cursor-pointer gap-3 rounded-control border p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${on ? "border-text" : "border-border"}`}
              style={{ outlineColor: s.palette.accentYellow }}
            >
              <input
                type="radio"
                name="video-style"
                value={s.id}
                checked={on}
                disabled={pending}
                onChange={() => {
                  setStyle(s.id);
                  start(async () => {
                    await action(s.id);
                  });
                }}
                className="mt-1 size-4 shrink-0"
              />
              <span className="min-w-0 space-y-2">
                <span className="block text-sm font-semibold">{s.label}</span>
                <span className="block text-xs text-muted">{s.shortDescription}</span>
                <span className="flex items-center gap-2" aria-hidden="true">
                  {Object.values(s.palette).map((c) => (
                    <span key={c} className="size-4 border" style={{ backgroundColor: c, borderColor: s.palette.ink }} />
                  ))}
                  <span className="ml-1 font-mono text-[11px] text-muted">
                    {s.aspectRatio} · {s.resolution.width}×{s.resolution.height} · {s.fps} fps
                  </span>
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
