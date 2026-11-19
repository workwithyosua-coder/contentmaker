import "@fontsource/montserrat/800.css";
import "@fontsource/montserrat/900.css";
import "@fontsource/jetbrains-mono/400.css";
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  END_FRAMES,
  timeline,
  type EpisodeLine,
  type EpisodeProps,
} from "../types";
import { ComicCharacter, type ComicGesture } from "./ComicCharacter";
import { buildShots, type Shot } from "./shots";
import { C, HEAVY, INK_PX, SHADOW, halftone } from "./theme";
import { UcoOcuWordmark } from "../brand/UcoOcuWordmark";

// Comic style (video/styles/comic.md). Layers per shot: stage (characters, no text) → overlays (banner, caption, SFX).
export type ComicProps = EpisodeProps & { reducedMotion?: boolean };

const border = `${INK_PX}px solid ${C.ink}`;

export function ComicEpisode({ lines, reducedMotion = false }: ComicProps) {
  const shots = buildShots(lines);
  const { end } = timeline(lines);
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      {shots.map((s) => (
        <Sequence
          key={s.id}
          from={s.startFrame}
          durationInFrames={s.durationInFrames}
          name={`${s.id} ${s.layout} ${s.speaker}`}
        >
          <Stage shot={s} line={lines[s.line]} reduced={reducedMotion} />
          <Overlays shot={s} reduced={reducedMotion} />
        </Sequence>
      ))}
      {lines.map((l, i) =>
        l.audio ? (
          <Sequence
            key={`a${i}`}
            from={shots[i].startFrame}
            durationInFrames={l.frames}
            layout="none"
            name={`voice ${i + 1}`}
          >
            <Audio
              src={
                /^(https?:|blob:|\/)/.test(l.audio)
                  ? l.audio
                  : staticFile(l.audio)
              }
              trimBefore={l.trimFrom ?? 0}
            />
          </Sequence>
        ) : null,
      )}
      <Sequence from={end} durationInFrames={END_FRAMES} name="end card">
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
}

/** Two-shot debate: one shared room, both characters lit, no divider. Paper wall, halftone, ink floor line. */
function DebateBackdrop() {
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: C.paper }} />
      <AbsoluteFill style={halftone(0.12)} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 1200, bottom: 0, backgroundColor: C.muted, borderTop: `${INK_PX}px solid ${C.ink}` }} />
    </AbsoluteFill>
  );
}

function mouthAt(l: EpisodeLine, f: number) {
  const e = l.envelope;
  if (!e.length || f >= e.length) return 0;
  const v = (e[f - 1] ?? 0) * 0.25 + (e[f] ?? 0) * 0.5 + (e[f + 1] ?? 0) * 0.25;
  if (v < 0.1) return 0;
  return v < 0.55 ? 0.45 : 1;
}

function ucoGesture(l: EpisodeLine): ComicGesture {
  if (l.thought_bubble || l.expression === "thinking") return "chin";
  if (/slides|offers|traktir/i.test(`${l.visual} ${l.text}`)) return "crossed";
  return ["angry", "furious", "excited", "shocked"].includes(l.expression)
    ? "rant"
    : "talk";
}

// ------------------------------------------------------------------ stage layer (no text)
function Stage({
  shot,
  line,
  reduced,
}: {
  shot: Shot;
  line: EpisodeLine;
  reduced: boolean;
}) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const talking = f < line.frames;
  const m = talking ? mouthAt(line, f) : 0;
  const uco = shot.speaker === "uco";
  const hot = ["angry", "furious", "excited", "shocked"].includes(
    line.expression,
  );
  const shakeAmp = reduced
    ? 0
    : (uco && hot
        ? interpolate(f, [0, 10], [14, 0], { extrapolateRight: "clamp" })
        : 0) + (uco && m === 1 ? 4 : 0);
  const sx = (random(`sx${f}`) - 0.5) * 2 * shakeAmp;
  const sy = (random(`sy${f}`) - 0.5) * 2 * shakeAmp;
  const pop = uco
    ? spring({
        frame: f,
        fps,
        config: { damping: 9, stiffness: 240, mass: 0.6 },
      })
    : 1;

  if (shot.layout !== "uco-solo-orange" && shot.layout !== "ocu-solo-teal") {
    const thought = shot.layout === "thought-dimmed-charcoal";
    const debate = shot.layout === "two-shot-debate";
    const side = (who: "uco" | "ocu") => {
      const speaking = who === shot.speaker;
      return (
        <div
          style={{
            position: "absolute",
            bottom: 380,
            width: 540,
            height: 740,
            [who === "uco" ? "left" : "right"]: 10,
            filter: !thought && !debate && !speaking ? "brightness(0.65)" : undefined,
          }}
        >
          {thought && <RimLight who={who} />}
          <div style={{ position: "absolute", inset: 0 }}>
            <ComicCharacter
              who={who}
              expression={
                speaking
                  ? line.expression
                  : thought
                    ? "thinking"
                    : who === "ocu"
                      ? "deadpan"
                      : "neutral"
              }
              mouth={speaking && !thought ? m : 0}
              frame={f + (who === "ocu" ? 37 : 0)}
              talking={speaking && talking && !thought}
              look={thought ? (who === "uco" ? -1 : 1) : who === "uco" ? 1 : -1}
              gesture={
                who === "uco"
                  ? speaking
                    ? ucoGesture(line)
                    : "none"
                  : "crossed"
              }
              still={reduced}
            />
          </div>
        </div>
      );
    };
    return (
      <AbsoluteFill style={{ transform: `translate(${sx}px, ${sy}px)` }}>
        {thought ? (
          <AbsoluteFill style={{ backgroundColor: C.ink }} />
        ) : debate ? (
          <DebateBackdrop />
        ) : (
          <SplitBackdrop speaker={shot.speaker} />
        )}
        {side("uco")}
        {side("ocu")}
        {thought && <ThoughtCloud left={uco} frame={f} reduced={reduced} />}
      </AbsoluteFill>
    );
  }

  if (uco) {
    const tilt = reduced ? -5 : -5 + Math.sin(f / 9) * 0.8;
    return (
      <AbsoluteFill style={{ transform: `translate(${sx}px, ${sy}px)` }}>
        <AbsoluteFill style={{ backgroundColor: C.uco }} />
        <AbsoluteFill style={halftone(0.16)} />
        <SpeedLines frame={f} reduced={reduced} />
        <AbsoluteFill
          style={{
            transform: `rotate(${tilt}deg) scale(1.28)`,
            transformOrigin: "50% 46%",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 120,
              right: 120,
              bottom: 330,
              height: 1150,
              transform: `translateY(${(1 - pop) * 140}px)`,
            }}
          >
            <ComicCharacter
              who="uco"
              expression={line.expression}
              mouth={m}
              frame={f}
              talking={talking}
              gesture={ucoGesture(line)}
              still={reduced}
            />
          </div>
        </AbsoluteFill>
        {["angry", "furious"].includes(line.expression) && (
          <Thermometer
            frame={f}
            level={line.expression === "furious" ? 1 : 0.7}
            reduced={reduced}
          />
        )}
      </AbsoluteFill>
    );
  }

  // Ocu solo: steady, upright, slow push-in
  const push = interpolate(
    f,
    [0, shot.durationInFrames],
    [1.12, reduced ? 1.12 : 1.22],
    { extrapolateRight: "clamp" },
  );
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: C.ocu }} />
      <AbsoluteFill style={halftone(0.2)} />
      <AbsoluteFill
        style={{ transform: `scale(${push})`, transformOrigin: "50% 46%" }}
      >
        <div
          style={{
            position: "absolute",
            left: 120,
            right: 120,
            bottom: 330,
            height: 1150,
          }}
        >
          <ComicCharacter
            who="ocu"
            expression={line.expression}
            mouth={m}
            frame={f}
            talking={talking}
            gesture={
              /sip|matcha|cup/i.test(line.visual ?? "") ? "lift" : "crossed"
            }
            gt={f}
            glen={line.frames}
            still={reduced}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function SplitBackdrop({ speaker }: { speaker: "uco" | "ocu" }) {
  const zig =
    "M 560 0 L 500 300 L 590 300 L 480 700 L 580 700 L 470 1120 L 570 1120 L 520 1920";
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: C.ocu }} />
      <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
        <path d={`M 0 0 ${zig.slice(2)} L 0 1920 Z`} fill={C.uco} />
      </svg>
      <AbsoluteFill style={halftone(0.16)} />
      {/* dim the side that isn't speaking */}
      <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
        {speaker === "ocu" ? (
          <path
            d={`M 0 0 ${zig.slice(2)} L 0 1920 Z`}
            fill={C.ink}
            opacity={0.25}
          />
        ) : (
          <path
            d={`M 1080 0 L ${zig.slice(2)} L 1080 1920 Z`}
            fill={C.ink}
            opacity={0.25}
          />
        )}
        <path
          d={zig}
          fill="none"
          stroke={C.ink}
          strokeWidth={22 + INK_PX * 2}
          strokeLinejoin="miter"
        />
        <path
          d={zig}
          fill="none"
          stroke={C.bolt}
          strokeWidth={22}
          strokeLinejoin="miter"
        />
      </svg>
    </AbsoluteFill>
  );
}

/** Flat coloured silhouette behind the character (no gradient glow): the thought-beat rim light. */
function RimLight({ who }: { who: "uco" | "ocu" }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: "scale(1.04)",
        opacity: 0.9,
      }}
    >
      <svg
        viewBox="0 0 600 820"
        width="100%"
        height="100%"
        style={{ overflow: "visible" }}
      >
        <ellipse
          cx={300}
          cy={300}
          rx={175}
          ry={200}
          fill={who === "uco" ? C.uco : C.ocu}
        />
        <path
          d="M 60 1300 L 66 820 C 76 590 180 512 300 506 C 420 512 524 590 534 820 L 540 1300 Z"
          fill={who === "uco" ? C.uco : C.ocu}
        />
      </svg>
    </div>
  );
}

function SpeedLines({ frame, reduced }: { frame: number; reduced: boolean }) {
  const o = reduced ? 0.55 : 0.4 + 0.3 * Math.abs(Math.sin(frame / 4));
  return (
    <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
      {Array.from({ length: 20 }, (_, i) => {
        const a = (i / 20) * Math.PI * 2 + 0.1;
        const r1 = 560 + (i % 3) * 60;
        return (
          <line
            key={i}
            x1={540 + Math.cos(a) * r1}
            y1={900 + Math.sin(a) * r1}
            x2={540 + Math.cos(a) * (r1 + 380)}
            y2={900 + Math.sin(a) * (r1 + 380)}
            stroke={C.bolt}
            strokeWidth={12 + (i % 3) * 8}
            opacity={o}
          />
        );
      })}
    </svg>
  );
}

function Thermometer({
  frame,
  level,
  reduced,
}: {
  frame: number;
  level: number;
  reduced: boolean;
}) {
  const { fps } = useVideoConfig();
  const fill =
    (reduced ? 1 : spring({ frame: frame - 4, fps, config: { damping: 10 } })) *
    level;
  const burst = level >= 1 && fill > 0.95;
  return (
    <svg
      viewBox="0 0 160 460"
      style={{
        position: "absolute",
        left: 460,
        top: 240,
        width: 160,
        height: 460,
      }}
    >
      <rect
        x={58}
        y={60}
        width={44}
        height={300}
        fill={C.paper}
        stroke={C.ink}
        strokeWidth={INK_PX * 2}
      />
      <rect
        x={66}
        y={68 + 284 * (1 - fill)}
        width={28}
        height={284 * fill}
        fill={C.red}
      />
      <circle
        cx={80}
        cy={392}
        r={48}
        fill={C.red}
        stroke={C.ink}
        strokeWidth={INK_PX * 2}
      />
      {burst &&
        [0, 1, 2].map((i) => {
          const t = reduced ? 0.4 : ((frame + i * 8) % 24) / 24;
          return (
            <circle
              key={i}
              cx={56 + i * 24}
              cy={48 - t * 70}
              r={14 + t * 18}
              fill={C.steam}
              stroke={C.ink}
              strokeWidth={INK_PX}
              opacity={1 - t * 0.8}
            />
          );
        })}
    </svg>
  );
}

function ThoughtCloud({
  left,
  frame,
  reduced,
}: {
  left: boolean;
  frame: number;
  reduced: boolean;
}) {
  const { fps } = useVideoConfig();
  const s = reduced ? 1 : spring({ frame, fps, config: { damping: 10 } });
  return (
    <svg
      viewBox="0 0 420 300"
      style={{
        position: "absolute",
        top: 330,
        [left ? "left" : "right"]: 60,
        width: 420,
        height: 300,
        transform: `scale(${s})`,
        transformOrigin: left ? "25% 100%" : "75% 100%",
      }}
    >
      <path
        d="M 96 196 a 52 52 0 0 1 -6 -102 a 72 72 0 0 1 122 -46 a 68 68 0 0 1 122 28 a 52 52 0 0 1 4 114 a 62 62 0 0 1 -114 14 a 62 62 0 0 1 -128 -8 Z"
        fill={C.paper}
        stroke={C.ink}
        strokeWidth={INK_PX * 2}
      />
      <circle
        cx={left ? 140 : 280}
        cy={248}
        r={16}
        fill={C.paper}
        stroke={C.ink}
        strokeWidth={INK_PX * 2}
      />
      <circle
        cx={left ? 116 : 304}
        cy={284}
        r={9}
        fill={C.paper}
        stroke={C.ink}
        strokeWidth={INK_PX * 2}
      />
    </svg>
  );
}

// ------------------------------------------------------------------ overlay layer (banner, caption, SFX)
function Overlays({ shot, reduced }: { shot: Shot; reduced: boolean }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = reduced
    ? 1
    : spring({ frame: f - 4, fps, config: { damping: 11, stiffness: 220 } });
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {shot.bannerText && (
        <div
          style={{
            position: "absolute",
            top: 200,
            left: 108,
            right: 108,
            display: "flex",
            justifyContent: "center",
            transform: `scale(${pop})`,
          }}
        >
          <div
            style={{
              background: shot.speaker === "uco" ? C.bolt : C.paper,
              border,
              boxShadow: SHADOW,
              padding: "16px 24px",
              fontFamily: HEAVY,
              fontWeight: 900,
              fontSize: shot.bannerText.length > 40 ? 44 : 58,
              lineHeight: 1.05,
              letterSpacing: -1,
              color: C.ink,
              textAlign: "center",
              textTransform: "uppercase",
            }}
          >
            {shot.bannerText}
          </div>
        </div>
      )}
      {shot.sfx && f > 6 && (
        <div
          style={{
            position: "absolute",
            top: 560,
            right: 120,
            transform: `rotate(-10deg) scale(${pop})`,
            background: C.bolt,
            border,
            boxShadow: SHADOW,
            padding: "6px 16px",
            fontFamily: HEAVY,
            fontWeight: 900,
            fontSize: 56,
            letterSpacing: -1,
            color: C.ink,
          }}
        >
          {shot.sfx}
        </div>
      )}
      <Caption shot={shot} />
    </AbsoluteFill>
  );
}

/** Indonesian line with the English underneath, in a paper box (0 px corners, hard shadow), lower third. */
function Caption({ shot }: { shot: Shot }) {
  const f = useCurrentFrame();
  const chunks = chunk(shot.dialogueId, 42);
  const at = Math.min(
    chunks.length - 1,
    Math.floor((f / Math.max(1, shot.durationInFrames)) * chunks.length),
  );
  const enChunks = chunk(shot.dialogueEn, 56);
  const enAt = Math.min(
    enChunks.length - 1,
    Math.floor((f / Math.max(1, shot.durationInFrames)) * enChunks.length),
  );
  return (
    <div
      style={{
        position: "absolute",
        left: 108,
        right: 108,
        bottom: 300,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: C.paper,
          border,
          boxShadow: SHADOW,
          padding: "12px 20px",
          maxWidth: 864,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: HEAVY,
            fontWeight: 900,
            fontSize: 46,
            lineHeight: 1.15,
            color: C.ink,
            fontStyle: shot.layout === "thought-dimmed-charcoal" ? "italic" : "normal",
          }}
        >
          {chunks[at]}
        </div>
        <div
          style={{
            fontFamily: HEAVY,
            fontWeight: 800,
            fontSize: 28,
            lineHeight: 1.2,
            color: C.ocu,
            marginTop: 6,
          }}
        >
          {enChunks[enAt]}
        </div>
      </div>
    </div>
  );
}

function chunk(text: string, max: number) {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && (cur + " " + w).length > max) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

function EndCard() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f, fps, config: { damping: 10 } });
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      <AbsoluteFill
        style={{
          ...halftone(0.5, 18),
          backgroundImage: `radial-gradient(rgba(248,246,240,0.08) 1.5px, transparent 1.5px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 600,
          left: 108,
          right: 108,
          textAlign: "center",
          transform: `scale(${pop})`,
        }}
      >
        <div
          style={{
            display: "inline-block",
            background: C.bolt,
            border,
            boxShadow: SHADOW,
            padding: "24px 36px",
          }}
        >
          <UcoOcuWordmark height={150} />
        </div>
        <div
          style={{
            marginTop: 40,
            fontFamily: HEAVY,
            fontWeight: 900,
            fontSize: 48,
            color: C.paper,
          }}
        >
          @uco.ocu
        </div>
      </div>
    </AbsoluteFill>
  );
}
