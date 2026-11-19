import type { AssetCheck } from "../../video/src/beats";

// Pre-render asset checklist: the illustrated props and sound effects this episode's lines call for, checked against
// what's in public/props and public/sfx (the asset manifest built at deploy). Missing ones still render (the video
// falls back to a coded prop, or plays no sound), but the list says which file to add.

export function AssetChecklist({ props, sfx }: { props: AssetCheck[]; sfx: AssetCheck[] }) {
  const missing = [...props, ...sfx].filter((a) => !a.ready);
  return (
    <div className="rounded-control border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Assets for this render</span>
        <span className="text-xs" style={{ color: missing.length ? "var(--bad)" : "var(--good)" }}>
          {missing.length ? `${missing.length} missing` : "All ready"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Group title="Props" items={props} empty="No illustrated props needed." note={(a) => `${a.lines.length > 1 ? "lines" : "line"} ${a.lines.join(", ")}`} />
        <Group title="Sound effects" items={sfx} empty="No sound effects cued." />
      </div>
      {missing.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Add the missing files to the repo at <code>public/</code> with these exact names. Until then the video uses a coded prop or skips the sound.
        </p>
      )}
    </div>
  );
}

function Group({ title, items, empty, note }: { title: string; items: AssetCheck[]; empty: string; note?: (a: AssetCheck) => string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((a) => (
            <li key={a.file} className="flex items-baseline gap-2 text-xs">
              <span aria-hidden style={{ color: a.ready ? "var(--good)" : "var(--bad)" }}>
                {a.ready ? "✓" : "✗"}
              </span>
              <code className="break-all">{a.file}</code>
              <span className="sr-only">{a.ready ? "ready" : "missing"}</span>
              {note && <span className="text-muted">{note(a)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
