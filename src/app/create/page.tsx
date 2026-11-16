import { Card } from "@/components/ui";

const steps = [
  ["Direction", "Tell the studio what you want to make"],
  ["Concepts", "Strategist proposes hooks and outlines, scored by the Analyst"],
  ["Footage", "Upload clips from your phone or desktop"],
  ["Style", "Pick from editing styles with preview clips (Figma-designed)"],
  ["Caption", "Pick per-platform captions from the Copywriter"],
  ["Edit & QA", "Editor agent cuts the video; QA checks it (optional CapCut polish)"],
  ["Approve & publish", "Thumbnails from Canva, scheduled at your best time"],
];

export default function CreatePage() {
  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Create</h1>
        <p className="text-sm text-muted">The creation pipeline arrives in the next build phases.</p>
      </header>
      <Card>
        <ol className="space-y-4">
          {steps.map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold">{i + 1}</span>
              <div>
                <div className="text-sm font-medium">{t}</div>
                <div className="text-sm text-muted">{d}</div>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
