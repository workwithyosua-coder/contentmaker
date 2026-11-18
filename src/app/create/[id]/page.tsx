import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh, CopyButton, StepButton } from "@/components/episode-ui";
import { ScriptEditor, ScriptLine } from "@/components/script-editor";
import { SetupNotice } from "@/components/setup-notice";
import { Card, PLATFORM_LABEL } from "@/components/ui";
import { EXPRESSIONS } from "@/lib/agents/writers-room";
import { getEpisode, type ScriptRow } from "@/lib/episodes";
import { estimateSeconds, formatDuration } from "@/lib/script-import";
import { recordingProgress } from "@/lib/recordings";
import { latestVideo } from "@/lib/render";
import { getDriveConnection } from "@/lib/drive";
import { getOwner } from "@/lib/queries";
import {
  approveScriptAction,
  deleteEpisodeAction,
  importScriptAction,
  moreIdeasAction,
  pickIdeaAction,
  reviseScriptAction,
  saveVideoToDriveAction,
  unpickIdeaAction,
  updateLineAction,
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
        <Episode params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Episode({
  params,
  searchParams,
}: {
  params: PageProps<"/create/[id]">["params"];
  searchParams: PageProps<"/create/[id]">["searchParams"];
}) {
  await connection();
  const { id } = await params;
  const wantVersion = Number((await searchParams).v) || null;
  const owner = await getOwner().catch(() => null);
  if (!owner) return <SetupNotice />;
  const ep = await getEpisode(owner.id, id);
  if (!ep) notFound();
  const { project, concepts, latestScript, captions } = ep;
  const [progress, video, drive] = await Promise.all([
    recordingProgress(project.id),
    latestVideo(project.id).catch(() => null),
    getDriveConnection(owner.id).catch(() => null),
  ]);
  const picked = concepts.find((c) => c.is_selected);
  const working = ["ideating", "scripting", "captioning"].includes(project.status);
  const scriptFailed = !latestScript && !!picked && !working && !!project.last_error;

  return (
    <div className="space-y-4">
      <AutoRefresh active={working} />
      <header>
        <h1 className="text-2xl font-semibold">{project.title ?? "New episode"}</h1>
        {project.direction && <p className="text-sm text-muted">Direction: {project.direction}</p>}
      </header>

      {working && (
        <Progress
          text={
            project.status === "ideating"
              ? "Brainstorming ideas (about 40 seconds)."
              : project.status === "captioning"
                ? "Writing captions for TikTok, Instagram, YouTube and Facebook (about 20 seconds)."
              : latestScript
                ? "Rewriting the script with your notes (about a minute)."
                : "Fact-checking with web search, then writing the dialogue (about 1.5 minutes)."
          }
        />
      )}

      {project.last_error && !working && (
        <div role="alert" className="rounded-card border p-4 text-sm" style={{ borderColor: "var(--bad)", background: "var(--bad-bg)" }}>
          <p className="font-semibold" style={{ color: "var(--bad)" }}>The last step didn&apos;t finish.</p>
          <p className="mt-1">{project.last_error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {project.status === "draft" && (
              <StepButton action={moreIdeasAction.bind(null, project.id)} label="Try again" pendingLabel="Starting…" />
            )}
            {scriptFailed && picked && (
              <>
                <StepButton action={pickIdeaAction.bind(null, project.id, picked.id)} label="Try writing again" pendingLabel="Starting…" />
                <StepButton action={unpickIdeaAction.bind(null, project.id)} label="Choose another idea" pendingLabel="…" variant="secondary" />
              </>
            )}
          </div>
        </div>
      )}

      {/* Step 1: ideas */}
      {!latestScript && concepts.length > 0 && (
        <Card
          title={picked ? `Writing: ${picked.title}` : "Pick an idea"}
          action={
            !picked && !working ? (
              <StepButton
                action={moreIdeasAction.bind(null, project.id)}
                label="5 new ideas"
                pendingLabel="Brainstorming…"
                variant="secondary"
              />
            ) : null
          }
        >
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
                {!picked && !working && (
                  <div className="mt-3">
                    <StepButton
                      action={pickIdeaAction.bind(null, project.id, c.id)}
                      label="Write this one"
                      pendingLabel="Starting…"
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Step 2: script */}
      {latestScript && (
        <ScriptView
          script={ep.scripts.find((x) => x.version === wantVersion) ?? latestScript}
          versions={ep.scripts.map((x) => x.version)}
          projectId={project.id}
          latestVersion={latestScript.version}
        />
      )}

      {latestScript && !working && (
        <Card title={latestScript.approved_at ? "Change the script" : "Happy with it?"}>
          <div className="space-y-4">
            {!latestScript.approved_at && (
              <StepButton
                action={approveScriptAction.bind(null, project.id)}
                label="Approve script & write captions"
                pendingLabel="Starting…"
              />
            )}
            <ScriptEditor
              reviseAction={reviseScriptAction.bind(null, project.id)}
              importAction={importScriptAction.bind(null, project.id)}
            />
          </div>
        </Card>
      )}

      {/* Step 3: captions */}
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

      {video && (
        <Card title="Episode video">
          <video src={video.url} controls playsInline preload="metadata" className="mx-auto max-h-[70vh] rounded-control bg-black" />
          <p className="mt-3 text-sm text-muted">
            Rendered {video.created_at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
            {video.duration_ms ? `, ${Math.round(video.duration_ms / 1000)} s long` : ""}.
          </p>
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <a href={`${video.url}&download=${encodeURIComponent((project.title ?? "episode") + ".mp4")}`} className="btn btn-secondary">
              Download MP4
            </a>
            {video.drive_url ? (
              <a href={video.drive_url} target="_blank" rel="noreferrer" className="btn btn-secondary">
                Open in Google Drive
              </a>
            ) : drive ? (
              <StepButton
                action={saveVideoToDriveAction.bind(null, project.id, video.id)}
                label={video.drive_error ? "Retry saving to Google Drive" : "Save to Google Drive"}
                pendingLabel="Copying to Drive…"
                variant="secondary"
              />
            ) : (
              <Link href="/accounts" className="btn btn-quiet">
                Connect Google Drive
              </Link>
            )}
          </div>
          {!video.drive_url && video.drive_error && (
            <p className="mt-2 text-xs" style={{ color: "var(--bad)" }}>
              Copy to Drive failed: {video.drive_error}
            </p>
          )}
          <p className="mt-2 text-xs text-muted">To edit in CapCut: open the video from Google Drive (or download it), then import it in CapCut.</p>
        </Card>
      )}

      {latestScript && !working && (
        <Card title={project.status === "recorded" ? "Voices recorded" : "Record the voices"}>
          <p className="mb-3 text-sm text-muted">
            {progress.recorded} of {progress.lines} lines recorded.
            {project.status === "recorded"
              ? " The animation step comes next."
              : latestScript.approved_at
                ? " Record each line with your phone, one at a time."
                : " You can record now or approve the script first. If you revise the script later, the new version starts with no takes."}
          </p>
          <Link href={`/create/${project.id}/record`} className="btn btn-primary">
            {progress.recorded ? "Open the recording booth" : "Start recording"}
          </Link>
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

function Progress({ text }: { text: string }) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-card border border-border bg-surface p-4">
      <span aria-hidden className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-accent" />
      <div className="text-sm">
        <p className="font-semibold">{text}</p>
        <p className="text-muted">You can leave this page or lock your phone. It keeps working and this page updates by itself.</p>
      </div>
    </div>
  );
}

function ScriptView({
  script,
  versions,
  projectId,
  latestVersion,
}: {
  script: ScriptRow;
  versions: number[];
  projectId: string;
  latestVersion: number;
}) {
  const plain = script.lines
    .map((l) => `${l.speaker === "uco" ? "UCO" : "OCU"}${l.thought_bubble ? " (thought)" : ""}: ${l.text}\n   [EN] ${l.subtitle}`)
    .join("\n");
  const isLatest = script.version === latestVersion;
  // Length from the lines themselves, not the writer's estimate.
  const duration = formatDuration(estimateSeconds(script.lines));
  const imported = script.feedback?.startsWith("Imported ");
  const note = script.feedback
    ? imported
      ? script.feedback
      : `Revised for: “${script.feedback.length > 160 ? `${script.feedback.slice(0, 157)}…` : script.feedback}”`
    : null;
  return (
    <Card
      title={`Script v${script.version}${versions.length > 1 ? ` of ${versions.length}` : ""} · ${script.lines.length} lines · ~${duration}`}
      action={<CopyButton text={`${script.title}\n\n${plain}`} label="Copy script" />}
    >
      {versions.length > 1 && (
        <nav aria-label="Script versions" className="mb-3 flex flex-wrap gap-1 text-xs">
          {[...versions].sort((a, b) => a - b).map((v) => (
            <Link
              key={v}
              href={v === latestVersion ? `/create/${projectId}` : `/create/${projectId}?v=${v}`}
              aria-current={v === script.version ? "page" : undefined}
              className={`inline-flex min-h-9 items-center rounded-control border px-2 font-semibold ${v === script.version ? "border-text text-text" : "border-border text-muted hover:text-text"}`}
            >
              v{v}
            </Link>
          ))}
        </nav>
      )}
      {!isLatest && <p className="mb-3 text-xs text-muted">An older version, view only. The newest version is v{latestVersion}.</p>}
      {note && <p className="mb-3 text-xs text-muted">{note}</p>}
      <ol className="space-y-2">
        {script.lines.map((l, i) => {
          const showBeat = i === 0 || script.lines[i - 1].beat !== l.beat;
          return (
            <li key={i}>
              {showBeat && <div className="mb-1 mt-4 text-xs font-bold text-muted">{BEAT_LABEL[l.beat] ?? l.beat}</div>}
              <ScriptLine
                line={{
                  speaker: l.speaker,
                  text: l.text,
                  subtitle: l.subtitle,
                  expression: l.expression,
                  thought_bubble: l.thought_bubble,
                  visual: l.visual,
                  on_screen_text: l.on_screen_text,
                }}
                expressions={EXPRESSIONS}
                editAction={isLatest ? updateLineAction.bind(null, projectId, script.id, i) : undefined}
              />
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
