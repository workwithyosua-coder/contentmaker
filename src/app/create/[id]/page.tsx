import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CopyButton, ReviseForm, StepButton } from "@/components/episode-ui";
import { SetupNotice } from "@/components/setup-notice";
import { Card, PLATFORM_LABEL } from "@/components/ui";
import { getEpisode, type ScriptRow } from "@/lib/episodes";
import { getOwner } from "@/lib/queries";
import {
  approveScriptAction,
  deleteEpisodeAction,
  moreIdeasAction,
  pickIdeaAction,
  reviseScriptAction,
} from "../actions";

export const maxDuration = 300;

const PILLAR_LABEL: Record<string, string> = {
  science: "Science",
  politics_society: "Politics & society",
  food: "Food",
  academics: "Academics",
  everyday_absurdities: "Everyday absurdities",
  trending_news: "Trending news",
};

const BEAT_LABEL: Record<string, string> = {
  hook: "Hook",
  counter: "Counter",
  escalation: "Escalation",
  insight: "Insight",
  concession: "Unspoken concession",
  button: "Punchline",
};

export const metadata: Metadata = { title: "Episode" };

export default function EpisodePage(props: PageProps<"/create/[id]">) {
  return (
    <>
      <Link href="/create" className="mb-2 inline-flex min-h-11 items-center text-sm font-semibold text-muted hover:text-text">
        ← All episodes
      </Link>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-surface-2" />}>
        <Episode params={props.params} />
      </Suspense>
    </>
  );
}

async function Episode({ params }: { params: PageProps<"/create/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const owner = await getOwner().catch(() => null);
  if (!owner) return <SetupNotice />;
  const ep = await getEpisode(owner.id, id);
  if (!ep) notFound();
  const { project, concepts, latestScript, captions } = ep;
  const picked = concepts.find((c) => c.is_selected);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{project.title ?? "New episode"}</h1>
        {project.direction && <p className="text-sm text-muted">Direction: {project.direction}</p>}
      </header>

      {/* Step 1 — ideas */}
      {!latestScript && (
        <Card
          title={picked ? "Writing the script…" : "Pick an idea"}
          action={
            !picked ? (
              <StepButton
                action={moreIdeasAction.bind(null, project.id)}
                label="5 new ideas"
                pendingLabel="Brainstorming…"
                variant="secondary"
              />
            ) : null
          }
        >
          {project.status === "scripting" && (
            <p className="mb-3 text-sm text-muted">Fact-checking with web search and writing the dialogue (about a minute)…</p>
          )}
          <ul className="space-y-3">
            {concepts.map((c) => (
              <li key={c.id} className="ticket px-6 py-4">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="stamp text-muted">{PILLAR_LABEL[c.hook_type ?? ""] ?? c.hook_type}</span>
                  {c.outline.needs_fact_check && <span className="text-muted">fact-checked before writing</span>}
                </div>
                <div className="font-semibold">{c.title}</div>
                <p className="mt-1 text-sm">
                  <b>{c.outline.hook_speaker === "uco" ? "Uco" : "Ocu"}:</b> “{c.hook}”
                </p>
                <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  <p><span className="font-semibold" style={{ color: "var(--uco)" }}>Uco</span>: {c.outline.uco_take}</p>
                  <p><span className="font-semibold" style={{ color: "var(--ocu)" }}>Ocu</span>: {c.outline.ocu_take}</p>
                </div>
                <p className="mt-2 text-xs text-muted">💡 {c.outline.enlightening_fact}</p>
                {!picked && (
                  <div className="mt-3">
                    <StepButton
                      action={pickIdeaAction.bind(null, project.id, c.id)}
                      label="Write this one"
                      pendingLabel="Fact-checking & writing… (~1 min)"
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Step 2 — script */}
      {latestScript && <ScriptView script={latestScript} versions={ep.scriptVersions} />}

      {latestScript && !latestScript.approved_at && (
        <Card title="Happy with it?">
          <div className="space-y-4">
            <StepButton
              action={approveScriptAction.bind(null, project.id)}
              label="Approve script & write captions"
              pendingLabel="Writing captions… (~20 s)"
            />
            <ReviseForm action={reviseScriptAction.bind(null, project.id)} />
          </div>
        </Card>
      )}

      {/* Step 3 — captions */}
      {captions.length > 0 && (
        <Card title="Captions">
          <ul className="space-y-4">
            {captions.map((c) => {
              const full = [c.title, c.caption, c.hashtags.map((h) => `#${h}`).join(" ")].filter(Boolean).join("\n\n");
              return (
                <li key={c.platform} className="rounded-control border border-border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold">{PLATFORM_LABEL[c.platform] ?? c.platform}</span>
                    <CopyButton text={full} />
                  </div>
                  {c.title && <p className="mb-1 text-sm font-semibold">{c.title}</p>}
                  <p className="whitespace-pre-line text-sm">{c.caption}</p>
                  {c.hashtags.length > 0 && <p className="mt-2 text-xs text-link">{c.hashtags.map((h) => `#${h}`).join(" ")}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {project.status === "awaiting_recording" && (
        <Card title="Next: record the voices">
          <p className="text-sm text-muted">
            The recording booth and the cartoon animation are being built next (phase 3). Your approved script is saved and will be
            ready to record line by line.
          </p>
        </Card>
      )}

      <StepButton
        action={deleteEpisodeAction.bind(null, project.id)}
        label="Delete episode"
        pendingLabel="Deleting…"
        variant="secondary"
        confirmText="Delete this episode, its ideas, scripts and captions?"
      />
    </div>
  );
}

function ScriptView({ script, versions }: { script: ScriptRow; versions: number }) {
  const plain = script.lines
    .map((l) => `${l.speaker === "uco" ? "UCO" : "OCU"}${l.thought_bubble ? " (thought)" : ""}: ${l.text}\n   [EN] ${l.subtitle}`)
    .join("\n");
  return (
    <Card
      title={`Script v${script.version}${versions > 1 ? ` of ${versions}` : ""} · ~${script.target_duration_s ?? "?"} s`}
      action={<CopyButton text={`${script.title}\n\n${plain}`} label="Copy script" />}
    >
      {script.feedback && <p className="mb-3 text-xs text-muted">Revised for: “{script.feedback}”</p>}
      <ol className="space-y-2">
        {script.lines.map((l, i) => {
          const showBeat = i === 0 || script.lines[i - 1].beat !== l.beat;
          const uco = l.speaker === "uco";
          return (
            <li key={i}>
              {showBeat && (
                <div className="mb-1 mt-4 text-xs font-bold text-muted">{BEAT_LABEL[l.beat] ?? l.beat}</div>
              )}
              <div className={`flex ${uco ? "justify-start" : "justify-end"}`}>
                <div
                  className={`max-w-[88%] rounded-card px-3 py-2 ${l.thought_bubble ? "border-2 border-dashed" : ""}`}
                  style={{
                    background: uco ? "var(--uco-bg)" : "var(--ocu-bg)",
                    borderColor: uco ? "var(--uco)" : "var(--ocu)",
                  }}
                >
                  <div className="mb-0.5 flex items-center gap-2 text-[11px]">
                    <span className="font-bold" style={{ color: uco ? "var(--uco)" : "var(--ocu)" }}>{uco ? "Uco" : "Ocu"}</span>
                    <span className="text-muted">{l.thought_bubble ? "💭 thinking" : l.expression}</span>
                  </div>
                  <p className="text-sm">{l.text}</p>
                  <p className="mt-0.5 text-xs italic text-muted">{l.subtitle}</p>
                  {(l.on_screen_text || l.visual) && (
                    <p className="mt-1 text-[11px] text-muted">
                      🎬 {l.visual}
                      {l.on_screen_text ? ` · on screen: “${l.on_screen_text}”` : ""}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {script.sources.length > 0 && (
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer font-semibold">Sources ({script.sources.length})</summary>
          <ul className="mt-2 space-y-1">
            {script.sources.map((s, i) => (
              <li key={i}>
                {s.claim}:{" "}
                <a href={s.url} target="_blank" rel="noreferrer" className="break-all text-link underline">{s.url}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {script.fact_sheet && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-semibold">Fact sheet used</summary>
          <p className="mt-2 whitespace-pre-line text-muted">{script.fact_sheet}</p>
        </details>
      )}
    </Card>
  );
}
