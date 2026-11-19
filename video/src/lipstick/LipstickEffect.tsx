import "@fontsource/luckiest-guy/400.css";
import "@fontsource/nunito/900.css";
import React from "react";
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Character, type Gesture } from "../Character";
import { Icon } from "../Props";
import { COLORS } from "../types";
import data from "./data.json";
import { UcoOcuWordmark } from "../brand/UcoOcuWordmark";

// "Uco & Ocu: Lipstick Effect" — 12 lines from one ElevenLabs dialogue file, prepared by scripts/lipstick_prepare.py
// (line cuts, tightened gaps, voice chain, word timings, synthesized BGM + SFX). Every cue below comes from data.json.

type Word = { w: string; s: number; e: number };
type Line = (typeof data.lines)[number] & { words: Word[] };
const LINES = data.lines as Line[];
const CUES = data.cues;
const INK = COLORS.ink;
const LOGO = "'Luckiest Guy', Impact, sans-serif";
const BODY = "Nunito, Arial, sans-serif";
const lineEnd = (l: Line) => l.start + l.frames;

// Shot groups: lines that share one continuous scene.
const GROUPS: { lines: number[]; Scene: React.FC<SceneProps> }[] = [
  { lines: [0], Scene: UcoPhone },
  { lines: [1], Scene: OcuLift },
  { lines: [2], Scene: UcoReceipt },
  { lines: [3], Scene: HouseSplit },
  { lines: [4], Scene: OcuCatastrophe },
  { lines: [5, 6, 7], Scene: JaggedSplit },
  { lines: [8, 9], Scene: Thoughts },
  { lines: [10, 11], Scene: Truce },
];

type SceneProps = { from: number; dur: number };

export function LipstickEffect() {
  const speechEnd = data.speechEnd;
  const endStart = speechEnd + data.slurpFrames;
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.canvas }}>
      {GROUPS.map((g, gi) => {
        const from = gi === 0 ? 0 : LINES[g.lines[0]].start;
        const next = GROUPS[gi + 1];
        const to = next ? LINES[next.lines[0]].start : endStart;
        return (
          <Sequence key={gi} from={from} durationInFrames={to - from} name={`shot ${gi + 1}: lines ${g.lines.map((l) => l + 1).join(", ")}`}>
            <g.Scene from={from} dur={to - from} />
          </Sequence>
        );
      })}
      <Sequence from={endStart} durationInFrames={data.endFrames} name="end card">
        <EndCard />
      </Sequence>
      <Captions />
      <Bug />
      <AudioMix />
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------- audio
function AudioMix() {
  const speaking = (f: number) => LINES.some((l) => f >= l.start - 4 && f < lineEnd(l) + 4);
  const L = (i: number) => LINES[i];
  // BGM: -22 dB bed (≈0.08), ducks under speech, drops out for the inner thoughts (9–10), swells on 11–12 and the end card.
  const bgmVolume = (f: number) => {
    const fade = (a: number, b: number) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const out = fade(L(8).start - 15, L(8).start) * (1 - fade(L(10).start - 10, L(10).start)); // 0..1 during 9–10
    let v = speaking(f) ? 0.05 : 0.08;
    if (f >= L(10).start) v = speaking(f) ? 0.09 : 0.13;
    if (f >= data.speechEnd + data.slurpFrames) v = 0.16;
    const intro = fade(0, 12);
    return v * (1 - out) * intro;
  };
  return (
    <>
      <Audio src={staticFile(data.bgm)} volume={bgmVolume} />
      {LINES.map((l) => (
        <Sequence key={l.index} from={l.start} durationInFrames={l.frames} name={`voice ${l.index + 1}`} layout="none">
          <Audio src={staticFile(l.audio)} />
        </Sequence>
      ))}
      {data.sfx.map((s, i) => (
        <Sequence key={i} from={s.at} durationInFrames={90} name={`sfx ${s.name}`} layout="none">
          <Audio src={staticFile(s.src)} volume={s.volume} />
        </Sequence>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- shared helpers
/** Which line is playing at absolute frame f (or the last one that started), plus its local frame. */
function lineAt(f: number, group: number[]) {
  let cur = LINES[group[0]];
  for (const i of group) if (f >= LINES[i].start) cur = LINES[i];
  return { line: cur, lf: f - cur.start, talking: f >= cur.start && f < lineEnd(cur) };
}

/** Multi-shape lip-sync: closed / mid-open / wide yell (Uco only); Ocu tops out at mid. Smoothed over 3 frames. */
function mouthFor(who: "uco" | "ocu", f: number, group: number[]) {
  const { line, lf, talking } = lineAt(f, group);
  if (!talking || line.speaker !== who) return 0;
  const e = line.envelope;
  const v = (e[lf - 1] ?? 0) * 0.25 + (e[lf] ?? 0) * 0.5 + (e[lf + 1] ?? 0) * 0.25;
  if (v < 0.1) return 0;
  if (who === "ocu") return 0.45;
  return v < 0.55 ? 0.45 : 1;
}

const halftone = (color: string, r = 4, size = 26): React.CSSProperties => ({
  backgroundImage: `radial-gradient(circle, ${color} ${r}px, transparent ${r + 0.6}px)`,
  backgroundSize: `${size}px ${size}px`,
});

function useAbs(from: number) {
  return useCurrentFrame() + from;
}

/** Fast overshoot spring for Uco, linear ease for Ocu. */
function entrance(who: "uco" | "ocu", lf: number, fps: number) {
  if (who === "uco") return spring({ frame: lf, fps, config: { damping: 7, stiffness: 260, mass: 0.6 } });
  return interpolate(lf, [0, 24], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) });
}

function shake(f: number, amp: number) {
  return { x: (random(`x${f}`) - 0.5) * 2 * amp, y: (random(`y${f}`) - 0.5) * 2 * amp };
}

function SpeedLines({ cx, cy, color, frame, count = 22, pulse = true }: { cx: number; cy: number; color: string; frame: number; count?: number; pulse?: boolean }) {
  const o = pulse ? 0.35 + 0.25 * Math.sin(frame / 3) : 0.4;
  return (
    <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 + random(`sl${i}`) * 0.2;
        const r1 = 420 + ((frame * 40 + i * 77) % 520);
        return (
          <line
            key={i}
            x1={cx + Math.cos(a) * r1}
            y1={cy + Math.sin(a) * r1}
            x2={cx + Math.cos(a) * (r1 + 260)}
            y2={cy + Math.sin(a) * (r1 + 260)}
            stroke={color}
            strokeWidth={10 + (i % 3) * 6}
            strokeLinecap="round"
            opacity={o}
          />
        );
      })}
    </svg>
  );
}

function Burst({ cx, cy, frame, color = COLORS.yellow, opacity = 0.3 }: { cx: number; cy: number; frame: number; color?: string; opacity?: number }) {
  const pts: string[] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2 + frame * 0.004;
    const r = i % 2 ? 1600 : 380 + random(`b${i}`) * 140;
    pts.push(`${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`);
  }
  return (
    <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
      <polygon points={pts.join(" ")} fill={color} opacity={opacity} />
    </svg>
  );
}

function UcoBg({ frame }: { frame: number }) {
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 50%, ${COLORS.ucoAmber} 0%, ${COLORS.uco} 48%, ${COLORS.ucoDeep} 100%)` }}>
      <Burst cx={540} cy={900} frame={frame} />
      <AbsoluteFill style={halftone("rgba(14,14,18,0.18)")} />
    </AbsoluteFill>
  );
}

function OcuBg() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.canvas }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 46%, ${COLORS.ocuTeal} 0%, ${COLORS.ocu}AA 34%, transparent 66%)` }} />
      <AbsoluteFill style={{ ...halftone("rgba(248,249,250,0.11)", 3.5, 22), WebkitMaskImage: "radial-gradient(circle at 50% 46%, black 30%, transparent 72%)" }} />
    </AbsoluteFill>
  );
}

function Puppet({
  who,
  box,
  expression,
  mouth,
  frame,
  talking,
  look = 0,
  gesture,
  gt = 0,
  glen = 90,
  dim = false,
  style,
}: {
  who: "uco" | "ocu";
  box: { left?: number; right?: number; bottom: number; width: number; height: number };
  expression: string;
  mouth: number;
  frame: number;
  talking: boolean;
  look?: number;
  gesture?: Gesture;
  gt?: number;
  glen?: number;
  dim?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ position: "absolute", ...box, filter: dim ? "brightness(0.55) saturate(0.7)" : undefined, transformOrigin: "50% 100%", ...style }}>
      <Character who={who} expression={expression} mouth={mouth} frame={frame} talking={talking} look={look} gesture={gesture} gt={gt} glen={glen} drink="#8DB255" />
    </div>
  );
}

// ---------------------------------------------------------------- shots
/** Line 1: tight close-up, 5° Dutch tilt, furious phone scrolling, pulsing speed lines. */
function UcoPhone({ from }: SceneProps) {
  const f = useAbs(from);
  const lf = useCurrentFrame();
  const { fps } = useVideoConfig();
  const g = [0];
  const m = mouthFor("uco", f, g);
  const s = entrance("uco", lf, fps);
  const sh = shake(f, m === 1 ? 7 : 2);
  return (
    <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px)` }}>
      <UcoBg frame={lf} />
      <SpeedLines cx={540} cy={860} color={COLORS.yellow} frame={lf} />
      <AbsoluteFill style={{ transform: `rotate(-5deg) scale(${1.38 + m * 0.03})`, transformOrigin: "50% 46%" }}>
        <Puppet
          who="uco"
          box={{ left: 100, bottom: 250, width: 880, height: 1200 }}
          expression="furious"
          mouth={m}
          frame={f}
          talking={m > 0}
          gesture="phone"
          gt={lf}
          style={{ transform: `translateY(${(1 - s) * 180}px) scale(${0.85 + 0.15 * s}, ${1.1 - 0.1 * s})` }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** Line 2: hard smash-cut to slouched Ocu on cool teal halftone, slowly lifting his iced matcha. */
function OcuLift({ from, dur }: SceneProps) {
  const f = useAbs(from);
  const lf = useCurrentFrame();
  const g = [1];
  const m = mouthFor("ocu", f, g);
  const zoom = interpolate(lf, [0, dur], [1.12, 1.24]);
  return (
    <AbsoluteFill>
      <OcuBg />
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "50% 48%" }}>
        <Puppet
          who="ocu"
          box={{ left: 100, bottom: 230, width: 880, height: 1200 }}
          expression="deadpan"
          mouth={m}
          frame={f}
          talking={m > 0}
          gesture="lift"
          gt={lf}
          glen={dur}
          style={{ transform: "rotate(1.5deg) translateY(30px)" }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** Line 3: whip-pan to Uco unrolling his bank statement; thermometer rises and vents steam on "matcha, serum, toner!". */
function UcoReceipt({ from, dur }: SceneProps) {
  const f = useAbs(from);
  const lf = useCurrentFrame();
  const g = [2];
  const m = mouthFor("uco", f, g);
  const whip = interpolate(lf, [0, 7], [1, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const steamAt = CUES.matchaWord - from;
  const level = interpolate(lf, [6, steamAt], [0.15, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const sh = shake(f, m === 1 ? 6 : 0 + (lf > steamAt && lf < steamAt + 12 ? 14 : 0));
  return (
    <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px)` }}>
      <UcoBg frame={lf} />
      <AbsoluteFill style={{ transform: `translateX(${-whip * 1100}px) scale(1.04)`, filter: whip > 0.02 ? `blur(${whip * 26}px)` : undefined, transformOrigin: "50% 60%" }}>
        <Puppet who="uco" box={{ left: 110, bottom: 300, width: 860, height: 1170 }} expression="furious" mouth={m} frame={f} talking={m > 0} gesture="receipt" gt={lf} glen={dur} />
        <Thermometer level={level} steam={lf >= steamAt} frame={lf} sinceSteam={lf - steamAt} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Thermometer({ level, steam, frame, sinceSteam }: { level: number; steam: boolean; frame: number; sinceSteam: number }) {
  const ding = steam ? Math.max(0, 1 - sinceSteam / 10) : 0;
  return (
    <svg viewBox="0 0 200 520" style={{ position: "absolute", left: 440, top: 230, width: 200, height: 520, transform: `rotate(${Math.sin(frame * 1.7) * (steam ? 5 : 1)}deg) scale(${1 + ding * 0.15})` }}>
      <rect x={76} y={60} width={48} height={330} rx={24} fill={COLORS.white} stroke={INK} strokeWidth={8} />
      <rect x={86} y={70 + 310 * (1 - level)} width={28} height={310 * level + 20} rx={14} fill="#E5383B" />
      {[120, 180, 240, 300].map((y) => (
        <line key={y} x1={124} x2={142} y1={y} y2={y} stroke={INK} strokeWidth={5} />
      ))}
      <circle cx={100} cy={418} r={52} fill="#E5383B" stroke={INK} strokeWidth={8} />
      {steam &&
        [0, 1, 2, 3, 4].map((i) => {
          const t = ((frame + i * 6) % 30) / 30;
          return (
            <circle key={i} cx={100 + (i - 2) * 26 + Math.sin(frame / 4 + i) * 10} cy={50 - t * 90} r={14 + t * 22} fill={COLORS.white} stroke={INK} strokeWidth={4} opacity={1 - t} />
          );
        })}
    </svg>
  );
}

/** Line 4: horizontal split. Top: the house shrinks into the distance while a glowing matcha cup grows. Bottom: calm Ocu. */
function HouseSplit({ from, dur }: SceneProps) {
  const f = useAbs(from);
  const lf = useCurrentFrame();
  const g = [3];
  const m = mouthFor("ocu", f, g);
  const p = interpolate(lf, [10, dur - 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) });
  const open = interpolate(lf, [0, 10], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.canvas }}>
      {/* top panel */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 900, overflow: "hidden", transform: `translateY(${(1 - open) * -900}px)` }}>
        <AbsoluteFill style={{ background: `linear-gradient(${COLORS.ocuDeep}, ${COLORS.ocu})` }} />
        <AbsoluteFill style={halftone("rgba(248,249,250,0.08)", 3, 22)} />
        {/* road to the vanishing point */}
        <svg viewBox="0 0 1080 900" style={{ position: "absolute", inset: 0 }}>
          <polygon points="380,900 700,900 560,430 520,430" fill="#2B3440" stroke={INK} strokeWidth={6} />
          <line x1={540} y1={900} x2={540} y2={440} stroke={COLORS.yellow} strokeWidth={8} strokeDasharray="40 30" strokeDashoffset={-lf * 6} />
        </svg>
        <div style={{ position: "absolute", left: 540 - 130, top: 520 - p * 120, width: 260, height: 260, transform: `scale(${1.3 - p * 1.15})`, opacity: 1 - p * 0.6 }}>
          <svg viewBox="0 0 200 200" width={260} height={260}>
            <Icon kind="house" frame={lf} />
          </svg>
        </div>
        <div style={{ position: "absolute", left: 760, top: 340, width: 220, height: 220, transform: `scale(${0.3 + p * 1.1})`, filter: `drop-shadow(0 0 ${20 + p * 40}px ${COLORS.yellow})` }}>
          <svg viewBox="0 0 200 200" width={220} height={220}>
            <Icon kind="cup" frame={lf} />
          </svg>
        </div>
      </div>
      {/* bottom panel */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 900, bottom: 0, overflow: "hidden", transform: `translateY(${(1 - open) * 1020}px)` }}>
        <OcuBg />
        <Puppet who="ocu" box={{ left: 200, bottom: 300, width: 680, height: 930 }} expression="calm" mouth={m} frame={f} talking={m > 0} />
      </div>
      <svg viewBox="0 0 1080 60" style={{ position: "absolute", left: 0, top: 870, width: 1080, height: 60 }}>
        <path d="M 0 30 L 140 10 L 280 46 L 420 12 L 560 44 L 700 14 L 840 46 L 980 12 L 1080 30" fill="none" stroke={COLORS.yellow} strokeWidth={18} />
        <path d="M 0 30 L 140 10 L 280 46 L 420 12 L 560 44 L 700 14 L 840 46 L 980 12 L 1080 30" fill="none" stroke={INK} strokeWidth={5} />
      </svg>
    </AbsoluteFill>
  );
}

/** Line 5: Ocu motionless; behind him a PAYLATER ice cube drifts by and a tiny sun explodes on "DHUARRR!!!". */
function OcuCatastrophe({ from }: SceneProps) {
  const f = useAbs(from);
  const lf = useCurrentFrame();
  const g = [4];
  const m = mouthFor("ocu", f, g);
  const boomAt = CUES.dhuarr - from;
  const sinceBoom = lf - boomAt;
  const sh = shake(f, sinceBoom >= 0 && sinceBoom < 16 ? 22 * (1 - sinceBoom / 16) : 0);
  const cubeIn = CUES.paylater - from - 30;
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.canvas, transform: `translate(${sh.x}px, ${sh.y}px)` }}>
      <AbsoluteFill style={halftone("rgba(248,249,250,0.06)", 3, 22)} />
      {/* PAYLATER cube drifting across */}
      <div
        style={{
          position: "absolute",
          top: 430 + Math.sin(lf / 20) * 20,
          left: interpolate(lf, [cubeIn, cubeIn + 150], [-240, 1100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          width: 230,
          height: 230,
          transform: `rotate(${lf * 0.6}deg)`,
          filter: `drop-shadow(8px 8px 0 ${INK})`,
        }}
      >
        <svg viewBox="0 0 200 200" width={230} height={230}>
          <Icon kind="paylater" frame={lf} />
        </svg>
      </div>
      {/* the tiny sun, then the explosion */}
      <div style={{ position: "absolute", left: 640, top: 300, width: 200, height: 200 }}>
        {sinceBoom < 0 ? (
          <svg viewBox="0 0 200 200" width={200} height={200} style={{ transform: `rotate(${lf}deg)` }}>
            {Array.from({ length: 10 }, (_, i) => (
              <line key={i} x1={100} y1={100} x2={100 + Math.cos((i / 10) * Math.PI * 2) * 86} y2={100 + Math.sin((i / 10) * Math.PI * 2) * 86} stroke={COLORS.ucoAmber} strokeWidth={10} strokeLinecap="round" />
            ))}
            <circle cx={100} cy={100} r={50} fill={COLORS.yellow} stroke={INK} strokeWidth={7} />
            <circle cx={84} cy={94} r={5} fill={INK} />
            <circle cx={116} cy={94} r={5} fill={INK} />
            <path d="M 82 114 Q 100 126 118 114" stroke={INK} strokeWidth={5} fill="none" />
          </svg>
        ) : (
          <Explosion t={sinceBoom} />
        )}
      </div>
      {sinceBoom >= 0 && sinceBoom < 4 && <AbsoluteFill style={{ backgroundColor: COLORS.white, opacity: 0.8 - sinceBoom * 0.2 }} />}
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 70%, ${COLORS.ocu}66, transparent 60%)` }} />
      {/* Ocu does not move: breathing slowed to near-still */}
      <Puppet who="ocu" box={{ left: 120, bottom: 160, width: 840, height: 1150 }} expression="deadpan" mouth={m} frame={Math.floor(f * 0.3)} talking={m > 0} />
    </AbsoluteFill>
  );
}

function Explosion({ t }: { t: number }) {
  const p = Math.min(1, t / 18);
  return (
    <svg viewBox="-200 -200 600 600" width={600} height={600} style={{ position: "absolute", left: -200, top: -200, overflow: "visible" }}>
      <polygon
        points={Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2;
          const r = (i % 2 ? 220 : 120) * (0.4 + p);
          return `${100 + Math.cos(a) * r},${100 + Math.sin(a) * r}`;
        }).join(" ")}
        fill={COLORS.yellow}
        stroke={INK}
        strokeWidth={8}
        opacity={1 - p * 0.7}
      />
      <text x={100} y={128} textAnchor="middle" fontFamily={LOGO} fontSize={90} fill={COLORS.uco} stroke={INK} strokeWidth={6} paintOrder="stroke" opacity={1 - Math.max(0, p - 0.6) * 2.5}>
        DHUAR!
      </text>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = i * 1.05;
        const r = 60 + p * 160;
        return <circle key={i} cx={100 + Math.cos(a) * r} cy={100 + Math.sin(a) * r} r={30 + p * 40} fill="#B8B8C0" stroke={INK} strokeWidth={5} opacity={0.9 - p * 0.5} />;
      })}
    </svg>
  );
}

/** Lines 6–8: vertical split with a jagged yellow divider. Uco points across (6); Ocu presents the 2001 clipping and the lipstick chart (7); Uco lunges over the line and slaps the chart off-screen (8). */
function JaggedSplit({ from }: SceneProps) {
  const f = useAbs(from);
  const lf = useCurrentFrame();
  const { fps } = useVideoConfig();
  const g = [5, 6, 7];
  const { line, lf: llf } = lineAt(f, g);
  const mU = mouthFor("uco", f, g);
  const mO = mouthFor("ocu", f, g);
  const l7 = LINES[6];
  const evidenceIn = l7.start - from + 8;
  const slapAt = CUES.slap - from;
  const flown = Math.max(0, Math.min(1, (lf - slapAt) / 10));
  const lunge =
    lf < slapAt - 10 ? 0 : lf < slapAt ? interpolate(lf, [slapAt - 10, slapAt], [0, 1], { easing: Easing.in(Easing.cubic) }) : interpolate(lf, [slapAt, slapAt + 14], [1, 0], { extrapolateRight: "clamp" });
  const sh = shake(f, (lf >= slapAt && lf < slapAt + 10 ? 18 : 0) + (mU === 1 ? 5 : 0));
  const uSpeaks = line.speaker === "uco";
  const ucoGesture: Gesture = line.index === 5 ? "point" : line.index === 7 ? (lunge > 0 ? "none" : "fist") : "hold";
  const evidence = spring({ frame: lf - evidenceIn, fps, config: { damping: 10 } });
  return (
    <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px)`, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${COLORS.ocuTeal}, ${COLORS.ocu})` }} />
      <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
        <path d="M 0 0 L 560 0 L 480 420 L 600 400 L 460 900 L 590 880 L 450 1400 L 570 1380 L 500 1920 L 0 1920 Z" fill={COLORS.uco} />
      </svg>
      <AbsoluteFill style={halftone("rgba(14,14,18,0.2)")} />
      <Puppet
        who="uco"
        box={{ left: 20, bottom: 330, width: 560, height: 770 }}
        expression={line.index === 6 ? "angry" : line.expression}
        mouth={mU}
        frame={f}
        talking={mU > 0}
        look={1}
        gesture={ucoGesture}
        gt={llf}
        dim={!uSpeaks}
        style={{ transform: `rotate(${uSpeaks ? -3 : 0}deg)` }}
      />
      <Puppet
        who="ocu"
        box={{ right: 20, bottom: 330, width: 560, height: 770 }}
        expression={line.index === 6 ? "calm" : "deadpan"}
        mouth={mO}
        frame={f + 37}
        talking={mO > 0}
        look={-1}
        gesture={line.index === 6 ? "present" : "hold"}
        dim={uSpeaks}
      />
      {/* evidence on Ocu's side: the 2001 clipping and the lipstick chart */}
      {lf >= evidenceIn && (
        <>
          <div style={{ position: "absolute", left: 640, top: 430, width: 220, height: 220, transform: `scale(${evidence}) rotate(-8deg)`, filter: `drop-shadow(8px 8px 0 ${INK})` }}>
            <svg viewBox="0 0 200 200" width={220} height={220}>
              <Icon kind="newspaper" frame={lf} />
              <text x={100} y={160} textAnchor="middle" fontFamily={LOGO} fontSize={30} fill={INK}>
                2001
              </text>
            </svg>
          </div>
          <div
            style={{
              position: "absolute",
              left: 800,
              top: 660,
              width: 210,
              height: 250,
              transform: `translate(${flown * 700}px, ${-flown * 260}px) rotate(${flown * 150}deg) scale(${evidence})`,
              filter: `drop-shadow(8px 8px 0 ${INK})`,
            }}
          >
            <svg viewBox="0 0 200 240" width={210} height={250}>
              <Icon kind="chart" frame={Math.max(0, lf - evidenceIn)} />
              <rect x={30} y={196} width={140} height={36} rx={6} fill={COLORS.white} stroke={INK} strokeWidth={5} />
              <text x={100} y={224} textAnchor="middle" fontFamily={LOGO} fontSize={24} fill="#D00000">
                LIPSTIK
              </text>
            </svg>
          </div>
        </>
      )}
      {/* Uco's arm lunging across the divider */}
      {lunge > 0 && (
        <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
          <g transform={`translate(400 1180) rotate(${-34 + (1 - lunge) * 30})`}>
            <line x1={0} y1={0} x2={170 + lunge * 420} y2={0} stroke={INK} strokeWidth={84} strokeLinecap="round" />
            <line x1={0} y1={0} x2={170 + lunge * 420} y2={0} stroke={COLORS.uco} strokeWidth={66} strokeLinecap="round" />
            <circle cx={200 + lunge * 420} cy={0} r={46} fill="#C98E62" stroke={INK} strokeWidth={8} />
            {[-30, -10, 10, 30].map((dy) => (
              <rect key={dy} x={214 + lunge * 420} y={dy - 9} width={60} height={20} rx={10} fill="#C98E62" stroke={INK} strokeWidth={6} />
            ))}
          </g>
        </svg>
      )}
      {lf >= slapAt && lf < slapAt + 12 && <SpeedLines cx={880} cy={780} color={COLORS.yellow} frame={lf} count={16} pulse={false} />}
      {lf >= slapAt && lf < slapAt + 10 && (
        <div style={{ position: "absolute", left: 650, top: 600, fontFamily: LOGO, fontSize: 120, color: COLORS.yellow, WebkitTextStroke: `8px ${INK}`, paintOrder: "stroke fill", transform: `rotate(-12deg) scale(${1 + (lf - slapAt) * 0.03})` }}>
          WHACK!
        </div>
      )}
      {/* jagged yellow divider on top */}
      <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
        <path d="M 560 0 L 480 420 L 600 400 L 460 900 L 590 880 L 450 1400 L 570 1380 L 500 1920" fill="none" stroke={COLORS.yellow} strokeWidth={28} strokeLinejoin="miter" />
        <path d="M 560 0 L 480 420 L 600 400 L 460 900 L 590 880 L 450 1400 L 570 1380 L 500 1920" fill="none" stroke={INK} strokeWidth={8} strokeLinejoin="miter" transform="translate(16 0)" />
      </svg>
    </AbsoluteFill>
  );
}

/** Lines 9–10: the room dims, amber rim on Uco, teal rim on Ocu; both glance away; thought clouds pop one after the other. */
function Thoughts({ from }: SceneProps) {
  const f = useAbs(from);
  const lf = useCurrentFrame();
  const { fps } = useVideoConfig();
  const g = [8, 9];
  const mU = mouthFor("uco", f, g);
  const mO = mouthFor("ocu", f, g);
  const dimIn = interpolate(lf, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const c1 = spring({ frame: LINES[8].start - from + 4 > lf ? -1 : lf - (LINES[8].start - from + 4), fps, config: { damping: 9 } });
  const c2 = spring({ frame: lf - (LINES[9].start - from + 4), fps, config: { damping: 9 } });
  return (
    <AbsoluteFill style={{ backgroundColor: "#141418" }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 22% 60%, ${COLORS.ucoAmber}${Math.round(0x55 * dimIn).toString(16).padStart(2, "0")}, transparent 42%), radial-gradient(ellipse at 78% 60%, ${COLORS.ocuTeal}${Math.round(0x88 * dimIn).toString(16).padStart(2, "0")}, transparent 42%)` }} />
      <AbsoluteFill style={halftone("rgba(248,249,250,0.05)", 3, 22)} />
      <Puppet who="uco" box={{ left: 40, bottom: 330, width: 520, height: 712 }} expression="thinking" mouth={mU} frame={f} talking={mU > 0} look={-1} gesture="chin" style={{ transform: "rotate(-4deg)", filter: `drop-shadow(-10px 0 18px ${COLORS.ucoAmber})` }} />
      <Puppet who="ocu" box={{ right: 40, bottom: 330, width: 520, height: 712 }} expression="thinking" mouth={mO} frame={f + 37} talking={mO > 0} look={1} style={{ transform: "rotate(4deg)", filter: `drop-shadow(10px 0 18px ${COLORS.ocuTeal})` }} />
      <Cloud x={70} y={360} scale={c1} tailLeft />
      <Cloud x={570} y={360} scale={c2} tailLeft={false} />
    </AbsoluteFill>
  );
}

function Cloud({ x, y, scale, tailLeft }: { x: number; y: number; scale: number; tailLeft: boolean }) {
  if (scale <= 0.01) return null;
  return (
    <svg viewBox="0 0 440 320" style={{ position: "absolute", left: x, top: y, width: 440, height: 320, transform: `scale(${scale})`, transformOrigin: tailLeft ? "30% 100%" : "70% 100%" }}>
      <path d="M 96 200 a 54 54 0 0 1 -6 -104 a 74 74 0 0 1 126 -48 a 70 70 0 0 1 124 28 a 54 54 0 0 1 4 116 a 64 64 0 0 1 -116 14 a 64 64 0 0 1 -132 -6 Z" fill={COLORS.white} stroke={INK} strokeWidth={8} />
      <circle cx={tailLeft ? 150 : 290} cy={252} r={18} fill={COLORS.white} stroke={INK} strokeWidth={6} />
      <circle cx={tailLeft ? 172 : 268} cy={292} r={11} fill={COLORS.white} stroke={INK} strokeWidth={5} />
      <text x={220} y={160} textAnchor="middle" fontFamily={LOGO} fontSize={70} fill={INK}>
        . . .
      </text>
    </svg>
  );
}

/** Lines 11–12 + slurp: lights snap back, wide two-shot at a table; Uco slides a matcha across; Ocu catches it, deadpans, slurps. */
function Truce({ from }: SceneProps) {
  const f = useAbs(from);
  const lf = useCurrentFrame();
  const g = [10, 11];
  const mU = mouthFor("uco", f, g);
  const mO = mouthFor("ocu", f, g);
  const slideAt = CUES.slide - from;
  const slide = interpolate(lf, [slideAt, slideAt + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const caught = lf >= slideAt + 16;
  const slurpFrom = data.speechEnd - from;
  const slurping = lf >= slurpFrom;
  const snap = interpolate(lf, [0, 3], [0.9, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: COLORS.ocu }} />
      <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
        <path d="M 0 0 L 600 0 L 500 520 L 620 500 L 460 1060 L 590 1040 L 420 1920 L 0 1920 Z" fill={COLORS.uco} />
        <path d="M 600 0 L 500 520 L 620 500 L 460 1060 L 590 1040 L 420 1920" fill="none" stroke={COLORS.yellow} strokeWidth={26} />
      </svg>
      <AbsoluteFill style={halftone("rgba(14,14,18,0.2)")} />
      <Puppet who="uco" box={{ left: 40, bottom: 700, width: 500, height: 684 }} expression="smug" mouth={mU} frame={f} talking={mU > 0} look={lf < slideAt ? -1 : 1} gesture="cross" style={{ transform: "rotate(-3deg)" }} />
      <Puppet
        who="ocu"
        box={{ right: 40, bottom: 700, width: 500, height: 684 }}
        expression="deadpan"
        mouth={slurping ? 0 : mO}
        frame={f + 37}
        talking={mO > 0}
        look={-1}
        gesture={!caught ? "none" : slurping ? "sipHold" : "hold"}
        gt={slurping ? lf - slurpFrom : 0}
      />
      {/* the table */}
      <svg viewBox="0 0 1080 760" style={{ position: "absolute", left: 0, bottom: 0, width: 1080, height: 760 }}>
        <rect x={-20} y={40} width={1120} height={60} fill="#7A4A2C" stroke={INK} strokeWidth={8} />
        <rect x={-20} y={100} width={1120} height={680} fill="#5A3520" stroke={INK} strokeWidth={8} />
        <path d="M 0 70 L 1080 70" stroke="#9C6640" strokeWidth={6} />
      </svg>
      {/* the sliding cup */}
      {!caught && lf >= slideAt - 2 && (
        <div style={{ position: "absolute", left: 260 + slide * 420, top: 1050, width: 150, height: 170, filter: `drop-shadow(6px 6px 0 ${INK})` }}>
          <svg viewBox="0 0 200 200" width={150} height={170}>
            <Icon kind="cup" frame={lf} />
          </svg>
        </div>
      )}
      {!caught && lf >= slideAt && lf < slideAt + 16 && (
        <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
          {[0, 1, 2].map((i) => (
            <line key={i} x1={160 + slide * 420} x2={260 + slide * 420} y1={1080 + i * 40} y2={1080 + i * 40} stroke={COLORS.white} strokeWidth={8} strokeLinecap="round" opacity={0.7} />
          ))}
        </svg>
      )}
      {snap > 0 && <AbsoluteFill style={{ backgroundColor: COLORS.white, opacity: snap }} />}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------- captions (single focal point)
/** TikTok-style Indonesian captions: 3–5 words per chunk, centred on y=1420, the active word in lightning yellow. */
function Captions() {
  const f = useCurrentFrame();
  const line = LINES.find((l) => f >= l.start && f < lineEnd(l) + 8);
  if (!line) return null;
  const lf = f - line.start;
  const chunks: Word[][] = [];
  let cur: Word[] = [];
  for (const w of line.words) {
    cur.push(w);
    const punct = /[,.!?…]$/.test(w.w);
    if (cur.length >= 5 || (punct && cur.length >= 3)) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) {
    if (cur.length < 3 && chunks.length) chunks[chunks.length - 1].push(...cur);
    else chunks.push(cur);
  }
  const chunk = chunks.find((c) => lf < c[c.length - 1].e + 2) ?? chunks[chunks.length - 1];
  const pop = interpolate(lf - chunk[0].s, [0, 4], [0.92, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 108, right: 108, top: 1420, transform: `translateY(-50%) scale(${pop})`, display: "flex", justifyContent: "center" }}>
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 66,
          lineHeight: 1.15,
          textAlign: "center",
          textTransform: "uppercase",
          fontStyle: line.thought ? "italic" : "normal",
          WebkitTextStroke: `12px ${INK}`,
          paintOrder: "stroke fill",
          textShadow: `0 8px 0 ${INK}`,
        }}
      >
        {chunk.map((w, i) => {
          const active = lf >= w.s && lf < w.e + 2;
          return (
            <span key={i} style={{ color: active ? COLORS.yellow : COLORS.white }}>
              {w.w.replace(/\.\.+$/, "…")}
              {i < chunk.length - 1 ? " " : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Bug() {
  return (
    <div style={{ position: "absolute", top: 192, left: 108 }}>
      <UcoOcuWordmark height={48} shadow={false} />
    </div>
  );
}

function EndCard() {
  const lf = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: lf, fps, config: { damping: 8, stiffness: 220 } });
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.canvas }}>
      <AbsoluteFill style={halftone("rgba(248,249,250,0.06)", 3, 22)} />
      <div style={{ position: "absolute", top: 520, left: 108, right: 108, textAlign: "center", transform: `scale(${pop})` }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <UcoOcuWordmark height={180} />
        </div>
        <div
          style={{
            margin: "70px auto 0",
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 58,
            lineHeight: 1.2,
            color: INK,
            background: COLORS.yellow,
            border: `7px solid ${INK}`,
            boxShadow: `12px 12px 0 ${INK}`,
            padding: "26px 30px",
          }}
        >
          {data.cta}
        </div>
        <div style={{ fontFamily: BODY, fontWeight: 900, fontSize: 48, color: COLORS.white, marginTop: 50 }}>@uco.ocu</div>
      </div>
    </AbsoluteFill>
  );
}
