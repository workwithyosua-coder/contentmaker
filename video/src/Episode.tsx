import "@fontsource/bangers/400.css";
import "@fontsource/luckiest-guy/400.css";
import "@fontsource/nunito/800.css";
import "@fontsource/nunito/900.css";
import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Character } from "./Character";
import { COLORS, END_FRAMES, GAP_FRAMES, type EpisodeLine, type EpisodeProps, type Speaker } from "./types";

const TITLE_FONT = "Bangers, Impact, sans-serif";
const LOGO_FONT = "'Luckiest Guy', Impact, sans-serif";
const BODY_FONT = "Nunito, Arial, sans-serif";

export function Episode({ lines }: EpisodeProps) {
  let from = 0;
  const placed = lines.map((line, i) => {
    const start = from;
    from += line.frames + GAP_FRAMES;
    return { line, start, prev: lines[i - 1] };
  });
  const last = lines[lines.length - 1];

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.charcoal }}>
      {placed.map(({ line, start, prev }) => (
        <Sequence key={line.index} from={start} durationInFrames={line.frames + GAP_FRAMES} name={`${line.index + 1} ${line.speaker}`}>
          <Shot line={line} prevSpeaker={prev?.speaker} />
          {line.audio && <Audio src={staticFile(line.audio)} />}
        </Sequence>
      ))}
      <Sequence from={from} durationInFrames={END_FRAMES} name="end card">
        <EndCard cta={last?.on_screen_text ?? null} />
      </Sequence>
      <Bug />
    </AbsoluteFill>
  );
}

/** How a line is framed: one character close up, or both in the frame. */
const isTwoShot = (l: EpisodeLine) => Boolean(l.thought_bubble) || l.beat === "concession" || l.beat === "button";

function Shot({ line, prevSpeaker }: { line: EpisodeLine; prevSpeaker?: Speaker }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mouth = smoothMouth(line.envelope, frame);
  const talking = frame < line.frames;

  // whip in from the side the speaker lives on (Uco left, Ocu right) when the speaker changes
  const enter = spring({ frame, fps, config: { damping: 18, stiffness: 160 }, durationInFrames: 10 });
  const fromSide = line.speaker === "uco" ? -1 : 1;
  const whip = prevSpeaker && prevSpeaker !== line.speaker ? (1 - enter) * 1080 * fromSide : 0;
  const zoom = interpolate(frame, [0, line.frames], [1, line.speaker === "ocu" ? 1.07 : 1.04], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <Backdrop line={line} />
      <AbsoluteFill style={{ transform: `translateX(${whip}px) scale(${zoom})`, transformOrigin: "50% 70%" }}>
        {isTwoShot(line) ? (
          <TwoShot line={line} mouth={mouth} talking={talking} frame={frame} />
        ) : (
          <Solo line={line} mouth={mouth} talking={talking} frame={frame} />
        )}
      </AbsoluteFill>
      {line.thought_bubble && <ThoughtCloud side={line.speaker} frame={frame} />}
      {line.on_screen_text && <Label text={line.on_screen_text} speaker={line.speaker} frame={frame} />}
      <Subtitle line={line} frame={frame} />
    </AbsoluteFill>
  );
}

function Solo({ line, mouth, talking, frame }: { line: EpisodeLine; mouth: number; talking: boolean; frame: number }) {
  const angerBoost = line.speaker === "uco" && ["angry", "furious"].includes(line.expression);
  return (
    <>
      <div style={{ position: "absolute", left: 90, right: 90, bottom: 230, height: 1250 }}>
        <Character who={line.speaker} expression={line.expression} mouth={mouth} frame={frame} talking={talking} />
      </div>
      {angerBoost && <AngerMeter level={line.expression === "furious" ? 1 : 0.55} frame={frame} />}
      {line.speaker === "ocu" && ["deadpan", "calm", "smug"].includes(line.expression) && <Dots frame={frame} />}
      {line.speaker === "ocu" && line.expression === "worried" && <RainCloud frame={frame} />}
    </>
  );
}

function TwoShot({ line, mouth, talking, frame }: { line: EpisodeLine; mouth: number; talking: boolean; frame: number }) {
  const side = (who: Speaker) => {
    const speaking = who === line.speaker;
    return (
      <div
        style={{
          position: "absolute",
          bottom: 260,
          width: 680,
          height: 930,
          [who === "uco" ? "left" : "right"]: -70,
          filter: speaking ? "none" : "brightness(0.62) saturate(0.7)",
          transform: `scale(${speaking ? 1.04 : 0.94})`,
          transformOrigin: "50% 100%",
        }}
      >
        <Character
          who={who}
          expression={speaking ? line.expression : line.thought_bubble ? "thinking" : "calm"}
          mouth={speaking ? mouth : 0}
          frame={frame + (who === "ocu" ? 37 : 0)}
          talking={speaking && talking}
          look={who === "uco" ? (line.thought_bubble ? -1 : 1) : line.thought_bubble ? 1 : -1}
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

function Backdrop({ line }: { line: EpisodeLine }) {
  const frame = useCurrentFrame();
  const dots = (color: string, size: number) => ({
    backgroundImage: `radial-gradient(circle, ${color} ${size}px, transparent ${size + 0.5}px)`,
    backgroundSize: "30px 30px",
  });
  if (isTwoShot(line)) {
    const dim = line.thought_bubble ? 0.55 : 0;
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{ backgroundColor: COLORS.ocu }} />
        <Bolt color={COLORS.uco} />
        <AbsoluteFill style={{ ...dots("rgba(0,0,0,0.12)", 4) }} />
        <AbsoluteFill style={{ backgroundColor: COLORS.charcoal, opacity: dim }} />
      </AbsoluteFill>
    );
  }
  if (line.speaker === "uco") {
    const hot = ["angry", "furious", "excited"].includes(line.expression);
    return (
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 55%, ${COLORS.ucoWarm} 0%, ${COLORS.uco} 50%, ${COLORS.ucoDeep} 100%)` }}>
        {hot && (
          <AbsoluteFill
            style={{
              background: `repeating-conic-gradient(from ${frame * 0.6}deg at 50% 55%, rgba(255,210,63,0.35) 0deg 7deg, transparent 7deg 16deg)`,
            }}
          />
        )}
        <AbsoluteFill style={{ ...dots("rgba(255,255,255,0.16)", 4) }} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 50%, #7FA3AB 0%, ${COLORS.ocu} 45%, ${COLORS.ocuDeep} 100%)` }}>
      <AbsoluteFill style={{ ...dots("rgba(255,255,255,0.10)", 3.5) }} />
    </AbsoluteFill>
  );
}

/** Indonesian on-screen text: a comic label at the top. */
function Label({ text, speaker, frame }: { text: string; speaker: Speaker; frame: number }) {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - 6, fps, config: { damping: 11, stiffness: 180 } });
  const size = text.length > 60 ? 50 : text.length > 34 ? 64 : 84;
  return (
    <div
      style={{
        position: "absolute",
        top: 230,
        left: 70,
        right: 70,
        display: "flex",
        justifyContent: "center",
        transform: `scale(${pop}) rotate(${speaker === "uco" ? -2.5 : 1.5}deg)`,
      }}
    >
      <div
        style={{
          fontFamily: TITLE_FONT,
          fontSize: size,
          lineHeight: 1.05,
          letterSpacing: 1.5,
          textAlign: "center",
          color: COLORS.ink,
          background: speaker === "uco" ? COLORS.yellow : COLORS.paper,
          border: `7px solid ${COLORS.ink}`,
          borderRadius: 14,
          padding: "16px 28px 10px",
          boxShadow: `10px 10px 0 ${COLORS.ink}`,
        }}
      >
        {text}
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
  const color = line.speaker === "uco" ? COLORS.uco : COLORS.ocu;
  return (
    <div style={{ position: "absolute", left: 60, right: 140, bottom: 330, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <div
        style={{
          fontFamily: TITLE_FONT,
          fontSize: 40,
          letterSpacing: 3,
          color: line.speaker === "uco" ? COLORS.ink : "#fff",
          background: color,
          border: `4px solid ${COLORS.ink}`,
          borderRadius: 10,
          padding: "4px 18px 0",
        }}
      >
        {line.speaker.toUpperCase()}
        {line.thought_bubble ? " (dalam hati)" : ""}
      </div>
      <div
        style={{
          fontFamily: BODY_FONT,
          fontWeight: 900,
          fontSize: 54,
          lineHeight: 1.18,
          textAlign: "center",
          color: "#fff",
          fontStyle: line.thought_bubble ? "italic" : "normal",
          background: "rgba(26,26,46,0.82)",
          borderRadius: 18,
          padding: "14px 26px",
        }}
      >
        {current}
      </div>
    </div>
  );
}

function chunk(text: string, max = 46) {
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
  const fill = spring({ frame: frame - 4, fps, config: { damping: 9 } }) * level;
  const shake = level >= 1 ? Math.sin(frame * 2.3) * 4 : 0;
  return (
    <svg viewBox="0 0 120 420" style={{ position: "absolute", right: 70, top: 560, width: 120, height: 420, transform: `translateX(${shake}px)` }}>
      <rect x={38} y={10} width={44} height={330} rx={22} fill="#fff" stroke={COLORS.ink} strokeWidth={7} />
      <rect x={47} y={20 + 310 * (1 - fill)} width={26} height={310 * fill + 20} rx={13} fill="#E23B3B" />
      <circle cx={60} cy={365} r={45} fill="#E23B3B" stroke={COLORS.ink} strokeWidth={7} />
      {level >= 1 &&
        [0, 1, 2].map((i) => {
          const t = ((frame + i * 9) % 27) / 27;
          return <circle key={i} cx={40 + i * 20} cy={10 - t * 60} r={10 + t * 14} fill="#fff" opacity={1 - t} stroke={COLORS.ink} strokeWidth={3} />;
        })}
    </svg>
  );
}

function RainCloud({ frame }: { frame: number }) {
  const bob = Math.sin(frame / 20) * 8;
  return (
    <svg viewBox="0 0 300 220" style={{ position: "absolute", right: 60, top: 560 + bob, width: 260, height: 190 }}>
      <path
        d="M 60 120 a 45 45 0 0 1 20 -85 a 60 60 0 0 1 110 -5 a 45 45 0 0 1 60 60 a 35 35 0 0 1 -20 30 Z"
        fill="#7C8BA1"
        stroke={COLORS.ink}
        strokeWidth={7}
        strokeLinejoin="round"
      />
      {[0, 1, 2, 3].map((i) => {
        const t = ((frame + i * 8) % 30) / 30;
        return <line key={i} x1={85 + i * 40} x2={80 + i * 40} y1={135 + t * 70} y2={150 + t * 70} stroke="#9BE7FF" strokeWidth={7} strokeLinecap="round" opacity={1 - t} />;
      })}
    </svg>
  );
}

function ThoughtCloud({ side, frame }: { side: Speaker; frame: number }) {
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12 } });
  const left = side === "uco";
  return (
    <svg
      viewBox="0 0 400 300"
      style={{ position: "absolute", top: 560, [left ? "left" : "right"]: 70, width: 400, height: 300, transform: `scale(${pop})`, opacity: 0.95 }}
    >
      <path
        d="M 90 190 a 50 50 0 0 1 0 -100 a 70 70 0 0 1 120 -40 a 60 60 0 0 1 110 40 a 50 50 0 0 1 -10 100 Z"
        fill="#fff"
        stroke={COLORS.ink}
        strokeWidth={7}
      />
      <circle cx={left ? 120 : 280} cy={232 + Math.sin(frame / 8) * 3} r={16} fill="#fff" stroke={COLORS.ink} strokeWidth={6} />
      <circle cx={left ? 100 : 300} cy={272} r={10} fill="#fff" stroke={COLORS.ink} strokeWidth={5} />
      <text x={200} y={155} textAnchor="middle" fontFamily={TITLE_FONT} fontSize={64} fill={COLORS.ink}>
        . . .
      </text>
    </svg>
  );
}

function Bug() {
  return (
    <div
      style={{
        position: "absolute",
        top: 120,
        left: 60,
        fontFamily: LOGO_FONT,
        fontSize: 40,
        letterSpacing: 1,
        color: "#fff",
        WebkitTextStroke: `2px ${COLORS.ink}`,
        textShadow: `4px 4px 0 ${COLORS.ink}`,
      }}
    >
      <span style={{ color: COLORS.uco }}>UCO</span> & <span style={{ color: COLORS.ocu }}>OCU</span>
    </div>
  );
}

function EndCard({ cta }: { cta: string | null }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12 } });
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: COLORS.charcoal }} />
      <div style={{ position: "absolute", left: 40, right: 40, top: 760, height: 1000, borderRadius: "50%", overflow: "hidden", border: `10px solid ${COLORS.ink}` }}>
        <AbsoluteFill style={{ backgroundColor: COLORS.ocu }} />
        <Bolt color={COLORS.uco} />
      </div>
      <div style={{ position: "absolute", left: -20, bottom: 0, width: 600, height: 820, transform: `translateY(${(1 - pop) * 400}px)` }}>
        <Character who="uco" expression="angry" mouth={0.7 + Math.sin(frame / 3) * 0.3} frame={frame} talking look={1} />
      </div>
      <div style={{ position: "absolute", right: -20, bottom: 0, width: 600, height: 820, transform: `translateY(${(1 - pop) * 400}px)` }}>
        <Character who="ocu" expression="smug" mouth={0} frame={frame + 37} talking={false} look={-1} />
      </div>
      <div style={{ position: "absolute", top: 220, left: 0, right: 0, textAlign: "center", transform: `scale(${pop})` }}>
        <div
          style={{
            fontFamily: LOGO_FONT,
            fontSize: 170,
            lineHeight: 1,
            color: "#FFF6DA",
            WebkitTextStroke: `8px ${COLORS.ink}`,
            paintOrder: "stroke fill",
            textShadow: `0 10px 0 ${COLORS.ink}`,
          }}
        >
          UCO & OCU
        </div>
        <div style={{ fontFamily: BODY_FONT, fontWeight: 900, fontSize: 52, color: "#fff", marginTop: 20, textShadow: `3px 3px 0 ${COLORS.ink}` }}>
          @uco.ocu
        </div>
        {cta && (
          <div
            style={{
              margin: "50px auto 0",
              maxWidth: 880,
              fontFamily: BODY_FONT,
              fontWeight: 900,
              fontSize: 48,
              lineHeight: 1.2,
              color: COLORS.ink,
              background: COLORS.paper,
              border: `6px solid ${COLORS.ink}`,
              borderRadius: 18,
              padding: "20px 30px",
              boxShadow: `8px 8px 0 ${COLORS.ink}`,
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

/** Amber on the left, slate on the right, split by a zig-zag lightning bolt. */
function Bolt({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 1080 1920" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <path d="M 0 0 L 640 0 L 520 640 L 640 620 L 470 1180 L 600 1160 L 430 1920 L 0 1920 Z" fill={color} />
      <path d="M 640 0 L 520 640 L 640 620 L 470 1180 L 600 1160 L 430 1920" fill="none" stroke={COLORS.ink} strokeWidth={8} strokeLinejoin="round" />
    </svg>
  );
}

/** Ocu's quiet "..." next to his head. */
function Dots({ frame }: { frame: number }) {
  return (
    <div style={{ position: "absolute", right: 110, top: 760, display: "flex", gap: 16 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            background: COLORS.ink,
            opacity: ((frame / 8 + i * 0.7) % 3) / 3 > 0.33 ? 1 : 0.35,
          }}
        />
      ))}
    </div>
  );
}
