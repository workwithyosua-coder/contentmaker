import { CopyButton } from "@/components/episode-ui";
import type { ShotPrompt } from "@/lib/shot-prompts";

const LAYOUT_LABEL: Record<string, string> = {
  "uco-solo-orange": "Uco solo",
  "ocu-solo-teal": "Ocu solo",
  "split-screen-jagged-yellow": "Split screen",
  "two-shot-debate": "Two-shot",
  "thought-dimmed-charcoal": "Inner thought",
};

/** One video-model prompt per script line, with the reference image to attach. */
export function ShotPrompts({ prompts }: { prompts: ShotPrompt[] }) {
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">Video prompts, shot by shot ({prompts.length})</summary>
      <p className="mb-3 text-xs text-muted">
        For Gemini or Veo: one clip per line. Attach the reference image named on each shot. Clips come back silent; your voice, captions and
        banners are added when you upload the edited video.
      </p>
      <ol className="space-y-3">
        {prompts.map((p) => (
          <li key={p.index} className="rounded-control border border-border p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                Shot {p.index + 1} · {LAYOUT_LABEL[p.layout] ?? p.layout} · {p.seconds} s
              </span>
              <span className="flex items-center gap-2">
                <a href={`/brand/${p.refAsset}`} download className="btn btn-quiet min-h-11 text-xs">
                  {p.refAsset}
                </a>
                <CopyButton text={p.prompt} />
              </span>
            </div>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs">{p.prompt}</pre>
          </li>
        ))}
      </ol>
    </details>
  );
}
