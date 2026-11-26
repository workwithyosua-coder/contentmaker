import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh, CopyButton, RenderProgress, StepButton } from "@/components/episode-ui";
import { EpisodePreview } from "@/components/episode-preview";
import { VideoStylePicker } from "@/components/video-style";
import { ShotPrompts } from "@/components/shot-prompts";
import { AssetChecklist } from "@/components/asset-checklist";
import { BeatTable, type TableLine } from "@/components/beat-inspector";
import { DirectionForm, ReplaceScriptForm } from "@/components/manual-import";
import { loadAttachedAssets } from "@/lib/attached-assets";
import { listStudioAssets, videoAssetUrls } from "@/lib/studio-assets";
import { needsAngry } from "@/lib/studioAssets";
import { parseDirection } from "../../../../video/src/direction";
import { replaceCustomScriptAction, saveBeatsAction, saveDirectionAction } from "../studio-actions";
import { requiredAssets } from "../../../../video/src/beats";
import { usesImportantMessages } from "../../../../video/src/styles/registry";
import { shotPrompts } from "@/lib/shot-prompts";
import { PublishPanel } from "@/components/publish-panel";
import { VideoUpload } from "@/components/video-upload";
import { ScriptEditor, ScriptLine } from "@/components/script-editor";
import { SetupNotice } from "@/components/setup-notice";
import { Card, PLATFORM_LABEL } from "@/components/ui";
import { EXPRESSIONS } from "@/lib/agents/writers-room";
import { getEpisode, type ScriptRow } from "@/lib/episodes";
import { estimateSeconds, formatDuration } from "@/lib/script-import";
import { getBooth, recordingProgress } from "@/lib/recordings";
import { latestRenderJob, renderButtonConfigured } from "@/lib/render-jobs";
import { latestVideo } from "@/lib/render";
import { getDriveConnection } from "@/lib/drive";
import { db } from "@/lib/db";
import { publishAccounts } from "@/lib/publish/accounts";
import { PUBLISH_PLATFORMS, defaultText, type PlatformCaptions } from "@/lib/publish/captions";
import { tiktokCreatorInfo } from "@/lib/publish/adapters";
import { publicationsFor } from "@/lib/publish/engine";
import { getOwner } from "@/lib/queries";
import {
  approveScriptAction,
  deleteEpisodeAction,
  importScriptAction,
  renderVideoAction,
  moreIdeasAction,
  pickIdeaAction,
  reviseScriptAction,
  saveVideoToDriveAction,
  setVideoStyleAction,
  startVideoUploadAction,
  finishVideoUploadAction,
  writePlatformCaptionsAction,
  unpickIdeaAction,
  updateLineAction,
} from "../actions";
import { approveWithoutAiAction, publishAction, setAutoPublishAction } from "../publish-actions";
import { setEpisodeVoiceAction } from "../voice-actions";
import { VoiceProviderPicker } from "@/components/voice-provider";
import { getEpisodeVoice } from "@/lib/voice/settings";
import { isActiveJob, missingModelMessage } from "@/lib/renderWorker";
import { rvcModelStatus } from "@/lib/studio-assets";
import { STUDIO_ASSETS_HREF } from "@/lib/voice/acting";

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
  const [progress, video, drive, booth, job] = await Promise.all([
    recordingProgress(project.id),
    latestVideo(project.id).catch(() => null),
    getDriveConnection(owner.id).catch(() => null),
    getBooth(owner.id, project.id).catch(() => null),
    latestRenderJob(project.id).catch(() => null),
  ]);
  // props / SFX attached in the app count as available for the beats, the inspector and the checklist
  const attached = await loadAttachedAssets().catch(() => ({ props: [] as string[], sfx: [] as string[] }));
  // uploaded props / SFX (public URLs) so the beat list and the in-app preview show them like the render does
  // (with the global Studio Assets: angry sprites and the urgent BGM)
  const [assetUrls, studio] = await Promise.all([
    videoAssetUrls().catch(() => ({ props: {} as Record<string, string>, sfx: {} as Record<string, string>, cast: {} as Record<string, string> })),
    listStudioAssets().catch(() => []),
  ]);
  const custom = Boolean(latestScript?.custom);
  const direction = latestScript?.direction ?? "";
  const voice = await getEpisodeVoice(project.id).catch(() => ({ provider: "gemini_tts" as const, preset: "standard" as const }));
  // Own Voice: say which character's .pth model is still missing (never a silent fallback to another voice)
  const ownVoiceNote =
    voice.provider === "gemini_tts_rvc"
      ? await rvcModelStatus()
          .then((m) => {
            const missing = (["uco", "ocu"] as const).filter((w) => !m[w]);
            return missing.length ? missingModelMessage(missing) : null;
          })
          .catch(() => null)
      : null;
  const rendering = isActiveJob(job?.status);
  const [[pubProject], pubAccounts, pubs] = await Promise.all([
    db()<{ platform_captions: PlatformCaptions | null; publish_settings: Record<string, object>; auto_publish: boolean; publish_at: Date | null; video_style: string }[]>`
      SELECT platform_captions, publish_settings, auto_publish, publish_at, video_style FROM content_projects WHERE id = ${project.id}`,
    publishAccounts(owner.id).catch(() => []),
    publicationsFor(project.id).catch(() => []),
  ]);
  // TikTok requires its live account info (privacy options, interaction settings, max length) on the posting screen.
  const ttAccount = pubAccounts.find((a) => a.platform === "tiktok" && a.health === "ok");
  const tiktokLive = ttAccount
    ? await tiktokCreatorInfo(ttAccount.id).then(
        (info) => ({ info }),
        (e: Error) => ({ error: e.message }),
      )
    : undefined;
  const publishing = pubs.some(
    (p) => p.status === "uploading" || p.status === "processing" || (p.status === "queued" && p.run_after.getTime() < Date.now() + 60_000),
  );
  const picked = concepts.find((c) => c.is_selected);
  const working = ["ideating", "scripting", "captioning"].includes(project.status);
  const scriptFailed = !latestScript && !!picked && !working && !!project.last_error;
  // "Approve script & write captions" failed (e.g. a $0 Anthropic balance): offer the no-AI way through
  const captionStepFailed = !!latestScript && !working && !!project.last_error && !pubProject?.platform_captions && project.status === "awaiting_script_approval";

  return (
    <div className="space-y-4">
      <AutoRefresh active={working || rendering || publishing} />
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
          <p className="font-semibold" style={{ color: "var(--bad)" }}>
            {aiCreditError(project.last_error) ? "The AI captions couldn't be written." : "The last step didn't finish."}
          </p>
          <p className="mt-1">{project.last_error}</p>
          {captionStepFailed && (
            <p className="mt-2">You can approve the script and write the captions yourself instead. Posting and scheduling don&apos;t use AI.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {captionStepFailed && (
              <StepButton action={approveWithoutAiAction.bind(null, project.id)} label="Continue without AI captions" pendingLabel="Approving…" />
            )}
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

      {latestScript && custom && (
        <Card title="Manual / Exact Import">
          <div className="space-y-6">
            <p className="text-xs text-muted">
              Your own script, parsed by fixed rules: no AI is used here or when the video renders. Blank fields are picked automatically from the
              line (punctuation, keywords, cues); the grey text shows the pick.
            </p>
            <BeatTable
              key={`${latestScript.id}-${JSON.stringify(latestScript.lines).length}`}
              lines={latestScript.lines as unknown as TableLine[]}
              recordedMs={Object.fromEntries(Object.entries(booth?.recorded ?? {}).map(([i, t]) => [i, t.durationMs]))}
              direction={direction}
              attached={attached}
              assetUrls={assetUrls}
              onSave={saveBeatsAction.bind(null, project.id, latestScript.id)}
            />
            <DirectionForm action={saveDirectionAction.bind(null, project.id, latestScript.id)} initial={direction} />
            <details>
              <summary className="cursor-pointer text-sm font-semibold">Paste a new version of the script</summary>
              <div className="mt-3">
                <ReplaceScriptForm action={replaceCustomScriptAction.bind(null, project.id)} direction={direction} />
              </div>
            </details>
          </div>
        </Card>
      )}

      {latestScript && !working && !custom && (
        <Card title={latestScript.approved_at ? "Change the script" : "Happy with it?"}>
          <div className="space-y-4">
            {!latestScript.approved_at && (
              <div className="space-y-2">
                <StepButton action={approveScriptAction.bind(null, project.id)} label="Approve script & write captions" pendingLabel="Starting…" />
                <StepButton action={approveWithoutAiAction.bind(null, project.id)} label="Approve without AI (write captions myself)" pendingLabel="Approving…" variant="outline" wide />
              </div>
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

      {booth?.script && (progress.recorded > 0 || custom) && (
        <Card title="Animation">
          <div className="space-y-4">
            <VideoStylePicker value={pubProject?.video_style ?? "classic"} action={setVideoStyleAction.bind(null, project.id)} />
            <EpisodePreview
              style={pubProject?.video_style ?? "classic"}
              title={booth.script.title || project.title || "Episode"}
              direction={custom ? direction : null}
              exact={custom}
              assetUrls={assetUrls}
              lines={booth.lines.map((l) => ({
                ...l, // custom scripts carry start_s / end_s / sfx / overlay / callouts too
                index: l.index,
                beat: l.beat,
                speaker: l.speaker,
                text: l.text,
                subtitle: l.subtitle,
                expression: l.expression,
                visual: l.visual,
                on_screen_text: l.on_screen_text,
                thought_bubble: l.thought_bubble,
                important_message: l.important_message ?? null,
                camera_shot: l.camera_shot ?? null,
                emotion: l.emotion ?? null,
                prop_tag: l.prop_tag ?? null,
                take: booth.recorded[l.index]?.url ?? null,
              }))}
            />
            <ShotPrompts
              prompts={shotPrompts(
                booth.lines.map((l) => ({ index: l.index, speaker: l.speaker, beat: l.beat, expression: l.expression, subtitle: l.subtitle, visual: l.visual, thought_bubble: l.thought_bubble })),
                pubProject?.video_style ?? "classic",
              )}
            />
            <div className="space-y-2 border-t border-border pt-4">
              {usesImportantMessages(pubProject?.video_style) && (
                <AssetChecklist
                  projectId={project.id}
                  urls={assetUrls}
                  studio={needsAngry(booth.lines) ? studio : undefined}
                  {...requiredAssets(
                    booth.lines.map((l) => ({
                      ...l,
                      index: l.index,
                      beat: l.beat,
                      speaker: l.speaker,
                      text: l.text,
                      subtitle: l.subtitle,
                      expression: l.expression,
                      visual: l.visual,
                      on_screen_text: l.on_screen_text,
                      thought_bubble: l.thought_bubble,
                      important_message: l.important_message ?? null,
                      camera_shot: l.camera_shot ?? null,
                      emotion: l.emotion ?? null,
                      prop_tag: l.prop_tag ?? null,
                    })),
                    { stamp: pubProject?.video_style === "editorial-paper-cutout", direction: custom ? { ...parseDirection(direction), exact: true } : null },
                  )}
                />
              )}
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
              {job && isActiveJob(job.status) && <RenderProgress job={job} />}
              {job && (
                <p className="text-xs" style={{ color: job.status === "failed" ? "var(--bad)" : undefined }}>
                  {job.status === "queued" && "Render queued on GitHub… "}
                  {(job.status === "running" || job.status === "rendering" || job.status === "converting_voice") && `Started ${(job.started_at ?? job.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Usually 15–20 minutes; this page updates by itself. `}
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
            {video.renderer === "upload" ? "Uploaded" : "Rendered"} {video.created_at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
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

      {latestScript && (
        <Card title={video ? "Replace the video" : "Episode video"}>
          <VideoUpload start={startVideoUploadAction.bind(null, project.id)} finish={finishVideoUploadAction.bind(null, project.id)} />
        </Card>
      )}

      {latestScript && (
        <Card title="Publish to social media">
          {!latestScript.approved_at && !pubProject?.platform_captions && (
            <div className="mb-4 space-y-2">
              <p className="text-sm text-muted">
                Approve the script (v{latestScript.version}) to unlock posting. The AI can write each platform&apos;s caption, or you can approve without AI and
                write them yourself (no Anthropic credit needed).
              </p>
              {custom ? (
                <>
                  {/* Manual / Exact Import episodes: the no-AI path comes first */}
                  <StepButton action={approveWithoutAiAction.bind(null, project.id)} label="Approve without AI (write captions myself)" pendingLabel="Approving…" wide />
                  <StepButton action={approveScriptAction.bind(null, project.id)} label="Approve script & write captions" pendingLabel="Starting…" variant="outline" wide />
                </>
              ) : (
                <>
                  <StepButton action={approveScriptAction.bind(null, project.id)} label="Approve script & write captions" pendingLabel="Starting…" wide />
                  <StepButton action={approveWithoutAiAction.bind(null, project.id)} label="Approve without AI (write captions myself)" pendingLabel="Approving…" variant="outline" wide />
                </>
              )}
            </div>
          )}
          {latestScript.approved_at && !pubProject?.platform_captions && (
            <div className="mb-4 space-y-2">
              <p className="text-sm text-muted">This script is approved but has no platform captions yet. Let the AI write them, or fill in defaults and edit them yourself.</p>
              <StepButton action={writePlatformCaptionsAction.bind(null, project.id)} label="Write platform captions" pendingLabel="Writing… (about 20 s)" wide />
              <StepButton action={approveWithoutAiAction.bind(null, project.id)} label="Write captions myself (no AI)" pendingLabel="Filling in…" variant="outline" wide />
            </div>
          )}
          <PublishPanel
            // new default captions (approval, AI rewrite) start the editable fields afresh
            key={JSON.stringify(pubProject?.platform_captions ?? null)}
            accounts={pubAccounts}
            defaults={Object.fromEntries(
              pubProject?.platform_captions ? PUBLISH_PLATFORMS.map((p) => [p, defaultText(p, pubProject.platform_captions!)]) : [],
            )}
            saved={pubProject?.publish_settings ?? {}}
            publications={pubs.map((p) => ({
              platform: p.platform,
              status: p.status,
              external_post_url: p.external_post_url,
              error: p.error,
              run_after: p.run_after.toISOString(),
              note: p.step?.note ?? null,
            }))}
            autoPublish={pubProject?.auto_publish ?? false}
            publishAt={pubProject?.publish_at && pubProject.publish_at.getTime() > Date.now() ? pubProject.publish_at.toISOString() : null}
            ready={
              !pubProject?.platform_captions
                ? "Approve the script first (with or without AI) to fill in each platform's title and caption."
                : !video
                  ? "Render the video first, then post it here (or switch on auto-post below)."
                  : null
            }
            action={publishAction.bind(null, project.id)}
            autoAction={setAutoPublishAction.bind(null, project.id)}
            tiktok={tiktokLive}
            videoSeconds={video?.duration_ms ? video.duration_ms / 1000 : null}
          />
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
          <div className="mt-4 border-t border-border pt-4">
            <VoiceProviderPicker provider={voice.provider} preset={voice.preset} onSave={setEpisodeVoiceAction.bind(null, project.id)} note={ownVoiceNote} noteHref={ownVoiceNote ? STUDIO_ASSETS_HREF : null} />
          </div>
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

/** Anthropic's "credit balance is too low" / billing errors, told apart from other failures. */
function aiCreditError(err: string | null): boolean {
  return Boolean(err && /credit balance|billing|insufficient (credit|funds|balance)|purchase credits/i.test(err));
}
