import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh, CopyButton, ReviseForm, StepButton } from "@/components/episode-ui";
import { EpisodePreview } from "@/components/episode-preview";
import { SetupNotice } from "@/components/setup-notice";
import { Card, PLATFORM_LABEL } from "@/components/ui";
import { getEpisode, type ScriptRow } from "@/lib/episodes";
import { getBooth, recordingProgress } from "@/lib/recordings";
import { latestRenderJob, renderButtonConfigured } from "@/lib/render-jobs";
import { latestVideo } from "@/lib/render";
import { getDriveConnection } from "@/lib/drive";
import { getOwner } from "@/lib/queries";
import {
  approveScriptAction,
  deleteEpisodeAction,
  moreIdeasAction,
  pickIdeaAction,
  reviseScriptAction,
  renderVideoAction,
  saveVideoToDriveAction,
  unpickIdeaAction,
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
  const [progress, video, drive, booth, job] = await Promise.all([
    recordingProgress(project.id),
    latestVideo(project.id).catch(() => null),
    getDriveConnection(owner.id).catch(() => null),
    getBooth(owner.id, project.id).catch(() => null),
    latestRenderJob(project.id).catch(() => null),
  ]);
  const rendering = job?.status === "queued" || job?.status === "running";
  const picked = concepts.find((c) => c.is_selected);
  const working = ["ideating", "scripting", "captioning"].includes(project.status);
  const scriptFailed = !latestScript && !!picked && !working && !!project.last_error;

  return (
    <div className="space-y-4">
      <AutoRefresh active={working || rendering} />
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
      {latestScript && <ScriptView script={latestScript} versions={ep.scriptVersions} />}

      {latestScript && !latestScript.approved_at && !working && (
        <Card title="Happy with it?">
          <div className="space-y-4">
            <StepButton
              action={approveScriptAction.bind(null, project.id)}
              label="Approve script & write captions"
              pendingLabel="Starting…"
            />
            <ReviseForm action={reviseScriptAction.bind(null, project.id)} />
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

      {booth?.script && progress.recorded > 0 && (
        <Card title="Animation">
          <div className="space-y-4">
            <EpisodePreview
              title={booth.script.title || project.title || "Episode"}
              lines={booth.lines.map((l) => ({
                index: l.index,
                beat: l.beat,
                speaker: l.speaker,
                text: l.text,
                subtitle: l.subtitle,
                expression: l.expression,
                visual: l.visual,
                on_screen_text: l.on_screen_text,
                thought_bubble: l.thought_bubble,
                take: booth.recorded[l.index]?.url ?? null,
              }))}
            />
            <div className="space-y-2 border-t border-border pt-4">
              {renderButtonConfigured() ? (
                <StepButton
                  action={renderVideoAction.bind(null, project.id)}
                  label={video ? "Render a new video" : "Render video"}
                  pendingLabel="Starting…"
                  variant={video ? "secondary" : "primary"}
                />
              ) : (
                <p className="text-xs text-muted">The Render button needs GITHUB_DISPATCH_TOKEN in Vercel.</p>
              )}
              {job && (
                <p className="text-xs" style={{ color: job.status === "failed" ? "var(--bad)" : undefined }}>
                  {job.status === "queued" && "Render queued on GitHub… "}
                  {job.status === "running" && `Rendering since ${job.updated_at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Usually 15–20 minutes; this page updates by itself. `}
                  {job.status === "done" && "Last render finished; the video is below. "}
                  {job.status === "failed" && `Last render failed: ${job.error ?? "unknown error"} `}
                  {job.run_url && (
                    <a href={job.run_url} target="_blank" rel="noreferrer" className="text-link underline">
                      Open on GitHub
                    </a>
                  )}
                </p>
              )}
            </div>
          </div>
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
