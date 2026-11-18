"use client";

import { useState, useTransition } from "react";
import type { StepResult } from "@/app/create/actions";

const STYLES = [
  { id: "classic", name: "Classic", hint: "The original look: art-bible characters, burst backgrounds, rounded captions." },
  { id: "comic", name: "Comic", hint: "2D vertical comic: badge characters, strict palette, flat colour, square panels, ID + EN captions." },
] as const;

/** Per-episode video style; the preview, Render video and the renderer all use it. */
export function VideoStylePicker({ value, action }: { value: "classic" | "comic"; action: (style: string) => Promise<StepResult> }) {
  const [style, setStyle] = useState(value);
  const [pending, start] = useTransition();
  return (
    <fieldset className="space-y-2">
      <legend className="label">Video style</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {STYLES.map((s) => (
          <label key={s.id} className={`flex min-h-11 cursor-pointer gap-3 rounded-control border p-3 ${style === s.id ? "border-text" : "border-border"}`}>
            <input
              type="radio"
              name="video-style"
              value={s.id}
              checked={style === s.id}
              disabled={pending}
              onChange={() => {
                setStyle(s.id);
                start(async () => {
                  await action(s.id);
                });
              }}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-semibold">{s.name}</span>
              <span className="block text-xs text-muted">{s.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
