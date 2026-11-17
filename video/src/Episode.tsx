import "@fontsource/bangers/400.css";
import "@fontsource/luckiest-guy/400.css";
import "@fontsource/nunito/800.css";
import "@fontsource/nunito/900.css";
import React from "react";
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Character } from "./Character";
import { Prop, propsFor } from "./Props";
import { COLORS, END_FRAMES, GAP_FRAMES, SAFE, type EpisodeLine, type EpisodeProps, type Speaker } from "./types";

const COMIC = "Bangers, Impact, sans-serif";
const LOGO = "'Luckiest Guy', Impact, sans-serif";
const BODY = "Nunito, Arial, sans-serif";

/** Ocu's signature iced drink, colored by what the episode is about. */
function drinkFor(lines: EpisodeLine[]) {
  const all = lines.map((l) => `${l.text} ${l.visual ?? ""}`).join(" ").toLowerCase();
  if (all.includes("matcha")) return "#8DB255";
  if (/kopi|coffee/.test(all)) return "#7B4B2A";
  if (/\bteh\b|tea/.test(all)) return "#C2803B";
  return null;
}

export function Episode({ lines }: EpisodeProps) {
  const drink = drinkFor(lines);
  let from = 0;
  const placed = lines.map((line, i) => {
    const start = from;
    from += line.frames + GAP_FRAMES;
    return { line, start, prev: lines[i - 1] };
  });
  const last = lines[lines.length - 1];

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.canvas }}>
      {placed.map(({ line, start, prev }) => (
        <Sequence key={line.index} from={start} durationInFrames={line.frames + GAP_FRAMES} name={`${line.index + 1} ${line.speaker} ${line.expression}`}>
          <Shot line={line} prev={prev} drink={drink} />
          {line.audio && <Audio src={staticFile(line.audio)} />}
        </Sequence>
      ))}
      <Sequence from={from} durationInFrames={END_FRAMES} name="end card">
        <EndCard cta={last?.on_screen_text ?? null} drink={drink} />
      </Sequence>
      <Bug />
    </AbsoluteFill>
  );
}

const isTwoShot = (l: EpisodeLine) => Boolean(l.thought_bubble) || l.beat === "concession" || l.beat === "button";
const hot = (l: EpisodeLine) => ["angry", "furious", "excited"].includes(l.expression);

function Shot({ line, prev, drink }: { line: EpisodeLine; prev?: EpisodeLine; drink: string | null }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mouth = smoothMouth(line.envelope, frame);
  const talking = frame < line.frames;
  const uco = line.speaker === "uco";
  const cut = !prev || prev.speaker !== line.speaker || isTwoShot(prev) !== isTwoShot(line);

  // Motion curves: Uco = fast overshoot + screen shake; Ocu = slow linear ease, long holds.
  let enter = "";
  let shake = { x: 0, y: 0 };
  if (uco) {
    const s = cut ? spring({ frame, fps, config: { damping: 7, stiffness: 260, mass: 0.6 } }) : 1;
    enter = `translateY(${(1 - s) * 160}px) scale(${0.82 + 0.18 * s}, ${1.12 - 0.12 * s})`; // squash & stretch pop
    const amp = cut && hot(line) ? interpolate(frame, [0, 14], [22, 0], { extrapolateRight: "clamp" }) : 0;
    const peak = talking && line.expression === "furious" ? mouth * 6 : 0;
    shake = { x: (random(`sx${frame}`) - 0.5) * 2 * (amp + peak), y: (random(`sy${frame}`) - 0.5) * 2 * (amp + peak) };
  } else {
    const t = cut ? interpolate(frame, [0, 24], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) }) : 1;
    enter = `translateX(${(1 - t) * 60}px)`;
  }
  const zoom = uco
    ? 1 + (talking ? mouth * 0.015 : 0)
    : interpolate(frame, [0, line.frames], [1, 1.06], { extrapolateRight: "clamp" }); // slow unbothered push-in
  const flash = uco && cut && hot(line) ? interpolate(frame, [0, 3], [0.9, 0], { extrapolateRight: "clamp" }) : 0;

  return (
    <AbsoluteFill style={{ transform: `translate(${shake.x}px, ${shake.y}px)` }}>
      <Backdrop line={line} frame={frame} />
      {line.beat === "hook" && <Bolts frame={frame} />}
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "50% 60%" }}>
        <AbsoluteFill style={{ transform: enter, transformOrigin: "50% 100%" }}>
          {isTwoShot(line) ? (
            <TwoShot line={line} mouth={mouth} talking={talking} frame={frame} drink={drink} />
          ) : (
            <Solo line={line} mouth={mouth} talking={talking} frame={frame} drink={drink} />
          )}
        </AbsoluteFill>
      </AbsoluteFill>
      {propsFor(line).map((p, i) => (
        <Prop key={p} kind={p} slot={i} line={line} frame={frame} />
      ))}
      {line.thought_bubble && <ThoughtCloud side={line.speaker} frame={frame} />}
      {line.on_screen_text && <CaptionCard text={line.on_screen_text} line={line} frame={frame} />}
      <Subtitle line={line} frame={frame} />
      {flash > 0 && <AbsoluteFill style={{ backgroundColor: COLORS.white, opacity: flash }} />}
    </AbsoluteFill>
  );
}

function Solo({ line, mouth, talking, frame, drink }: { line: EpisodeLine; mouth: number; talking: boolean; frame: number; drink: string | null }) {
  const uco = line.speaker === "uco";
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: SAFE.left - 20,
          right: SAFE.right - 20,
          bottom: 250,
          height: 1180,
          transform: uco ? "rotate(-2deg) translateY(-10px)" : "rotate(1.5deg) translateY(30px)", // Uco leans in, Ocu slumps
          transformOrigin: "50% 100%",
        }}
      >
        <Character who={line.speaker} expression={line.expression} mouth={mouth} frame={frame} talking={talking} drink={drink} />
      </div>
      {uco && ["angry", "furious"].includes(line.expression) && <AngerMeter level={line.expression === "furious" ? 1 : 0.6} frame={frame} />}
    </>
  );
}

function TwoShot({ line, mouth, talking, frame, drink }: { line: EpisodeLine; mouth: number; talking: boolean; frame: number; drink: string | null }) {
  const side = (who: Speaker) => {
    const speaking = who === line.speaker;
    return (
      <div
        style={{
          position: "absolute",
          bottom: 300,
          width: 480,
          height: 656,
          [who === "uco" ? "left" : "right"]: SAFE.left - 30,
          filter: speaking ? "none" : "brightness(0.6) saturate(0.7)",
          transform: `scale(${speaking ? 1.04 : 0.95})`,
          transformOrigin: "50% 100%",
        }}
      >
        <Character
          who={who}
          expression={speaking ? line.expression : line.thought_bubble ? "thinking" : "calm"}
          mouth={speaking ? mouth : 0}
          frame={frame + (who === "ocu" ? 37 : 0)}
          talking={speaking && talking}
          look={line.thought_bubble ? (who === "uco" ? -1 : 1) : who === "uco" ? 1 : -1}
          drink={drink}
        />
      </div>
    );
  };
  return (
    <>
      {side("uco")}
      {side("ocu")}
    </>
  );
}

const dots = (color: string, r: number, size = 26) => ({
  backgroundImage: `radial-gradient(circle, ${color} ${r}px, transparent ${r + 0.6}px)`,
  backgroundSize: `${size}px ${size}px`,
});

function Backdrop({ line, frame }: { line: EpisodeLine; frame: number }) {
  if (isTwoShot(line)) {
    const dim = line.thought_bubble;
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{ background: `radial-gradient(circle at 75% 45%, ${COLORS.ocuTeal}, ${COLORS.ocu} 55%, ${COLORS.ocuDeep})` }} />
        <ZigZag color={COLORS.uco} />
        <AbsoluteFill style={dots("rgba(14,14,18,0.22)", 4)} />
        {dim && (
          <>
            <AbsoluteFill style={{ backgroundColor: COLORS.canvas, opacity: 0.68 }} />
            {/* rim lights: amber on Uco's side, teal on Ocu's */}
            <AbsoluteFill style={{ background: `radial-gradient(ellipse at 18% 55%, ${COLORS.ucoAmber}55, transparent 45%), radial-gradient(ellipse at 82% 55%, ${COLORS.ocuTeal}77, transparent 45%)` }} />
          </>
        )}
      </AbsoluteFill>
    );
  }
  if (line.speaker === "uco") {
    return (
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 52%, ${COLORS.ucoAmber} 0%, ${COLORS.uco} 48%, ${COLORS.ucoDeep} 100%)` }}>
        {hot(line) && <Burst frame={frame} />}
        <AbsoluteFill style={dots("rgba(14,14,18,0.18)", 4)} />
      </AbsoluteFill>
    );
  }
  // Ocu: dark charcoal with a cool halftone spotlight
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.canvas }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 48%, ${COLORS.ocu}EE 0%, ${COLORS.ocuTeal}88 30%, transparent 62%)` }} />
      <AbsoluteFill
        style={{
          ...dots("rgba(248,249,250,0.10)", 3.5, 22),
          WebkitMaskImage: "radial-gradient(circle at 50% 48%, black 0%, black 35%, transparent 70%)",
        }}
      />
    </AbsoluteFill>
  );
}

/** Lightning-yellow comic impact burst rays + speed lines behind Uco. */
function Burst({ frame }: { frame: number }) {
  const rays = 22;
  const pts: string[] = [];
  for (let i = 0; i < rays * 2; i++) {
    const a = (i / (rays * 2)) * Math.PI * 2 + frame * 0.004;
    const r = i % 2 ? 1500 : 380 + random(`b${i}`) * 120;
    pts.push(`${540 + Math.cos(a) * r},${1000 + Math.sin(a) * r}`);
  }
  return (
    <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
      <polygon points={pts.join(" ")} fill={COLORS.yellow} opacity={0.32} />
      {Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2 + 0.2;
        const r1 = 620 + ((frame * 30 + i * 90) % 400);
        return (
          <line key={i} x1={540 + Math.cos(a) * r1} y1={1000 + Math.sin(a) * r1} x2={540 + Math.cos(a) * (r1 + 160)} y2={1000 + Math.sin(a) * (r1 + 160)} stroke={COLORS.white} strokeWidth={6} opacity={0.5} />
        );
      })}
    </svg>
  );
}

/** Uco's warm side on the left, Ocu's cool side on the right, split by a jagged yellow zig-zag. */
function ZigZag({ color }: { color: string }) {
  const d = "M 0 0 L 600 0 L 500 520 L 620 500 L 460 1060 L 590 1040 L 420 1920 L 0 1920 Z";
  return (
    <svg viewBox="0 0 1080 1920" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <path d={d} fill={color} />
      <path d="M 600 0 L 500 520 L 620 500 L 460 1060 L 590 1040 L 420 1920" fill="none" stroke={COLORS.yellow} strokeWidth={26} strokeLinejoin="miter" />
      <path d="M 600 0 L 500 520 L 620 500 L 460 1060 L 590 1040 L 420 1920" fill="none" stroke={COLORS.ink} strokeWidth={8} strokeLinejoin="miter" transform="translate(16 0)" />
    </svg>
  );
}

/** Yellow lightning bolts crackling around the frame (the hook). */
function Bolts({ frame }: { frame: number }) {
  const on = Math.floor(frame / 4) % 2 === 0;
  const bolt = (x: number, y: number, s: number, r: number, k: number) => (
    <path
      key={k}
      d="M 0 0 L 40 0 L 22 50 L 50 46 L 6 130 L 18 66 L -8 70 Z"
      transform={`translate(${x} ${y}) scale(${s}) rotate(${r})`}
      fill={COLORS.yellow}
      stroke={COLORS.ink}
      strokeWidth={4}
      opacity={on || k % 2 ? 1 : 0.4}
    />
  );
  return (
    <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
      {bolt(150, 430, 1.4, -20, 0)}
      {bolt(860, 400, 1.6, 15, 1)}
      {bolt(130, 980, 1.1, -35, 2)}
      {bolt(900, 1000, 1.2, 30, 3)}
    </svg>
  );
}

/** Kinetic comic caption card: a jagged speech burst with a heavy drop shadow; first word in yellow. */
function CaptionCard({ text, line, frame }: { text: string; line: EpisodeLine; frame: number }) {
  const { fps } = useVideoConfig();
  const uco = line.speaker === "uco";
  const pop = uco
    ? spring({ frame: frame - 5, fps, config: { damping: 8, stiffness: 240 } })
    : interpolate(frame, [8, 26], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.quad) });
  const size = text.length > 70 ? 46 : text.length > 40 ? 58 : 76;
  const [first, ...rest] = text.split(" ");
  const w = 864;
  const h = size * (text.length > 40 ? 3.3 : 2.4) + 40;
  // jagged edge
  const n = 28;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = i % 2 ? 1 : 0.9 + random(`c${line.index}${i}`) * 0.04;
    pts.push(`${w / 2 + Math.cos(a) * (w / 2) * r},${h / 2 + Math.sin(a) * (h / 2) * r}`);
  }
  return (
    <div
      style={{
        position: "absolute",
        top: SAFE.top + 60,
        left: SAFE.left,
        width: w,
        height: h,
        transform: `scale(${pop}) rotate(${uco ? -2.5 : 1}deg)`,
        opacity: uco ? 1 : pop,
      }}
    >
      <svg viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <polygon points={pts.join(" ")} fill={COLORS.ink} transform="translate(12 12)" />
        <polygon points={pts.join(" ")} fill={COLORS.white} stroke={COLORS.ink} strokeWidth={7} strokeLinejoin="miter" />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: "0 90px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          fontFamily: COMIC,
          fontSize: size,
          lineHeight: 1.05,
          letterSpacing: 1.5,
          color: COLORS.ink,
        }}
      >
        <span>
          <span style={{ color: COLORS.yellow, WebkitTextStroke: `3px ${COLORS.ink}`, paintOrder: "stroke fill" }}>{first}</span> {rest.join(" ")}
        </span>
      </div>
    </div>
  );
}

/** English subtitles, split into short chunks timed by length. */
function Subtitle({ line, frame }: { line: EpisodeLine; frame: number }) {
  const chunks = chunk(line.subtitle);
  const total = chunks.reduce((s, c) => s + c.length, 0);
  let acc = 0;
  let current = chunks[chunks.length - 1];
  for (const c of chunks) {
    const end = ((acc + c.length) / total) * line.frames;
    if (frame < end) {
      current = c;
      break;
    }
    acc += c.length;
  }
  const uco = line.speaker === "uco";
  return (
    <div style={{ position: "absolute", left: SAFE.left, right: SAFE.right, bottom: SAFE.bottom + 100, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div
        style={{
          fontFamily: COMIC,
          fontSize: 40,
          letterSpacing: 3,
          color: uco ? COLORS.ink : COLORS.white,
          background: uco ? COLORS.ucoAmber : COLORS.ocuTeal,
          border: `4px solid ${COLORS.ink}`,
          boxShadow: `5px 5px 0 ${COLORS.ink}`,
          padding: "4px 18px 0",
        }}
      >
        {line.speaker.toUpperCase()}
        {line.thought_bubble ? " (dalam hati)" : ""}
      </div>
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 50,
          lineHeight: 1.18,
          textAlign: "center",
          color: COLORS.white,
          fontStyle: line.thought_bubble ? "italic" : "normal",
          background: "rgba(14,14,18,0.85)",
          border: `4px solid ${COLORS.ink}`,
          borderRadius: 14,
          padding: "12px 24px",
        }}
      >
        {current}
      </div>
    </div>
  );
}

function chunk(text: string, max = 44) {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
    if (/[.!?]$/.test(w) && cur.length > max * 0.45) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

function AngerMeter({ level, frame }: { level: number; frame: number }) {
  const { fps } = useVideoConfig();
  const fill = spring({ frame: frame - 4, fps, config: { damping: 7 } }) * level;
  const shake = level >= 1 ? Math.sin(frame * 2.3) * 5 : 0;
  return (
    <svg viewBox="0 0 140 440" style={{ position: "absolute", right: SAFE.right + 10, top: 560, width: 120, height: 380, transform: `translateX(${shake}px) rotate(12deg)` }}>
      <rect x={46} y={20} width={48} height={330} rx={24} fill={COLORS.white} stroke={COLORS.ink} strokeWidth={8} />
      <rect x={56} y={30 + 310 * (1 - fill)} width={28} height={310 * fill + 20} rx={14} fill="#E5383B" />
      {[80, 140, 200, 260].map((y) => (
        <line key={y} x1={94} x2={112} y1={y} y2={y} stroke={COLORS.ink} strokeWidth={5} />
      ))}
      <circle cx={70} cy={378} r={50} fill="#E5383B" stroke={COLORS.ink} strokeWidth={8} />
      {level >= 1 &&
        [0, 1, 2].map((i) => {
          const t = ((frame + i * 9) % 27) / 27;
          return <circle key={i} cx={46 + i * 24} cy={14 - t * 70} r={12 + t * 16} fill={COLORS.white} opacity={1 - t} stroke={COLORS.ink} strokeWidth={4} />;
        })}
    </svg>
  );
}

function ThoughtCloud({ side, frame }: { side: Speaker; frame: number }) {
  const { fps } = useVideoConfig();
  const pop = side === "uco" ? spring({ frame, fps, config: { damping: 9 } }) : interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  const left = side === "uco";
  return (
    <svg
      viewBox="0 0 420 300"
      style={{ position: "absolute", top: 520, [left ? "left" : "right"]: SAFE.left + 10, width: 400, height: 286, transform: `scale(${pop})`, transformOrigin: left ? "20% 100%" : "80% 100%" }}
    >
      <path
        d="M 90 190 a 52 52 0 0 1 -6 -100 a 70 70 0 0 1 120 -46 a 66 66 0 0 1 118 26 a 52 52 0 0 1 4 112 a 60 60 0 0 1 -110 14 a 60 60 0 0 1 -126 -6 Z"
        fill={COLORS.white}
        stroke={COLORS.ink}
        strokeWidth={8}
      />
      <circle cx={left ? 110 : 310} cy={238 + Math.sin(frame / 10) * 3} r={18} fill={COLORS.white} stroke={COLORS.ink} strokeWidth={6} />
      <circle cx={left ? 84 : 336} cy={278} r={10} fill={COLORS.white} stroke={COLORS.ink} strokeWidth={5} />
      <text x={210} y={150} textAnchor="middle" fontFamily={COMIC} fontSize={70} fill={COLORS.ink}>
        . . .
      </text>
    </svg>
  );
}

function Bug() {
  return (
    <div style={{ position: "absolute", top: SAFE.top, left: SAFE.left, fontFamily: LOGO, fontSize: 38, color: COLORS.white, WebkitTextStroke: `6px ${COLORS.ink}`, paintOrder: "stroke fill" }}>
      <span style={{ color: COLORS.ucoAmber }}>UCO</span> & <span style={{ color: "#7FB3C8" }}>OCU</span>
    </div>
  );
}

function EndCard({ cta, drink }: { cta: string | null; drink: string | null }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 8, stiffness: 200 } });
  const slow = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) });
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.canvas }}>
      <div style={{ position: "absolute", left: SAFE.left, right: SAFE.right, top: 820, bottom: SAFE.bottom, overflow: "hidden", border: `8px solid ${COLORS.ink}`, borderRadius: 28 }}>
        <AbsoluteFill style={{ background: `linear-gradient(${COLORS.ocuTeal}, ${COLORS.ocu})` }} />
        <ZigZag color={COLORS.uco} />
        <AbsoluteFill style={dots("rgba(14,14,18,0.22)", 4)} />
        <div style={{ position: "absolute", left: -40, bottom: -60, width: 520, height: 710, transform: `translateY(${(1 - pop) * 300}px)` }}>
          <Character who="uco" expression="furious" mouth={0.75 + Math.sin(frame / 2.5) * 0.25} frame={frame} talking look={1} />
        </div>
        <div style={{ position: "absolute", right: -40, bottom: -60, width: 520, height: 710, transform: `translateY(${(1 - slow) * 300}px)` }}>
          <Character who="ocu" expression="smug" mouth={0} frame={frame + 37} talking={false} look={-1} drink={drink} />
        </div>
      </div>
      <div style={{ position: "absolute", top: SAFE.top + 70, left: SAFE.left, right: SAFE.right, textAlign: "center", transform: `scale(${pop})` }}>
        <div style={{ fontFamily: LOGO, fontSize: 150, lineHeight: 1, color: COLORS.white, WebkitTextStroke: `10px ${COLORS.ink}`, paintOrder: "stroke fill", textShadow: `0 12px 0 ${COLORS.ink}` }}>
          UCO & OCU
        </div>
        <div style={{ fontFamily: BODY, fontWeight: 900, fontSize: 48, color: COLORS.yellow, marginTop: 14 }}>@uco.ocu</div>
        {cta && (
          <div
            style={{
              margin: "36px auto 0",
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 44,
              lineHeight: 1.2,
              color: COLORS.ink,
              background: COLORS.white,
              border: `6px solid ${COLORS.ink}`,
              boxShadow: `10px 10px 0 ${COLORS.ink}`,
              padding: "18px 26px",
            }}
          >
            {cta}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}

/** Mouth openness for a frame: loudness, smoothed, with a little flutter so long vowels still move. */
function smoothMouth(env: number[], frame: number) {
  if (!env.length || frame >= env.length) return 0;
  const a = env[Math.max(0, frame - 1)] ?? 0;
  const b = env[frame] ?? 0;
  const c = env[frame + 1] ?? 0;
  const v = a * 0.25 + b * 0.5 + c * 0.25;
  if (v < 0.08) return 0;
  return Math.min(1, v * (0.85 + 0.15 * Math.sin(frame * 1.7)));
}
