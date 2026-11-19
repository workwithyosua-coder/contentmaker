import React from "react";
import { AbsoluteFill } from "remotion";
import type { Beat } from "../beats";
import { CastPuppet } from "../cast/CastPuppet";
import { mouthOpenAt, type CastVariant } from "../cast/CastSvg";
import { CAST_BOTTOM, CAST_GAP, CastFigure, castLayout } from "../cast/CueShared";
import type { EpisodeLine } from "../types";
import { PropStage, propLabel, type Box, type PropSkin } from "./PropStage";

// The Director lays out each beat as a camera shot, under the style's headline card and above its background:
//   solo-uco / solo-ocu  the speaker big on one side over a warm (Uco) or cool (Ocu) wash, topic prop on the other
//   closeup-punch        the speaker's face filling the frame, with a frame-driven micro-shake
//   two-shot             both characters side by side (the listener dimmed)
//   cta-stinger          two-shot, Ocu pointing at TikTok's + Follow (x 920, y 780)
// Faces always end above y 1100 (subtitles live in y 1120..1250); props stay in x 60..940, y 520..1080.

export type DirectorSkin = {
  variant: CastVariant;
  prop: PropSkin;
  /** backdrop washes behind solo / close-up shots */
  wash: { uco: string; ocu: string; kind: "flat" | "glow" };
  fxColor: string;
  rim: { uco: string | null; ocu: string | null };
  /** how much the listener is darkened in a two-shot (0..1) */
  dimListener: number;
  /** extra graphics per figure (e.g. HUD brackets and voice meters), drawn on the full canvas */
  figureExtras?: (f: { who: "uco" | "ocu"; cx: number; top: number; s: number; on: boolean; level: number; frame: number }) => React.ReactNode;
};

type Placed = { who: "uco" | "ocu"; cx: number; top: number; s: number; on: boolean; transform?: string };

export function DirectorStage({
  beat,
  line,
  frame,
  cardBottom,
  skin,
  reduced,
}: {
  beat: Beat;
  line: EpisodeLine | null;
  /** frame inside the beat */
  frame: number;
  /** canvas y where the headline card ends */
  cardBottom: number;
  skin: DirectorSkin;
  reduced: boolean;
}) {
  const shot = beat.cameraShot;
  const cta = shot === "cta-stinger";
  const g = frame + beat.startFrame;
  const level = line && line.envelope.length ? (line.envelope[frame] ?? 0) : 0;
  const talking = line && line.envelope.length ? mouthOpenAt(line.envelope, frame) : !reduced && !cta && Math.floor(frame / 4) % 2 === 0;
  const ucoOn = beat.speaker === "uco" || beat.speaker === "both";
  const ocuOn = beat.speaker === "ocu" || beat.speaker === "both";
  const top0 = cardBottom + CAST_GAP;

  let placed: Placed[];
  let prop: Box | null = null;
  let washFor: "uco" | "ocu" | null = null;

  if (shot === "solo-uco" || shot === "solo-ocu") {
    const who = shot === "solo-uco" ? "uco" : "ocu";
    const s = ((CAST_BOTTOM - top0) / 340) * 1.1;
    const intense = who === "uco" && (beat.emotion === "triumphant" || beat.emotion === "shocked");
    placed = [{ who, cx: who === "uco" ? 330 : 750, top: top0, s, on: true, transform: intense && !reduced ? "rotate(-4deg)" : undefined }];
    const y = Math.min(780, Math.max(520, top0));
    prop = who === "uco" ? { x: 570, y, w: 360, h: 1080 - y } : { x: 70, y, w: 360, h: 1080 - y };
    washFor = who;
  } else if (shot === "closeup-punch") {
    const who = beat.speaker === "ocu" ? "ocu" : "uco";
    // face (hair top y 8 → chin y 104 in the drawing) fills the frame but ends above y 1090
    const s = Math.min(6.2, (1090 - top0) / 96);
    const shake = reduced ? { x: 0, y: 0 } : { x: Math.sin(frame * 1.7) * 5 + Math.sin(frame * 4.1) * 2, y: Math.cos(frame * 2.3) * 4 };
    placed = [{ who, cx: 540 + shake.x, top: top0 - 8 * s + shake.y, s, on: true }];
    washFor = who;
  } else {
    const L = castLayout({ cardBottom, cta, frame, reduced });
    placed = [
      { who: "uco", cx: L.uco, top: L.top, s: L.s, on: ucoOn },
      { who: "ocu", cx: L.ocu, top: L.top, s: L.s, on: ocuOn },
    ];
  }

  const look = (who: "uco" | "ocu") => (cta || placed.length === 1 ? 0 : who === "uco" ? (ocuOn && !ucoOn ? 1 : 0.4) : ucoOn && !ocuOn ? -1 : -0.4);
  const label = propLabel(beat.importantMessage.stamp, line?.on_screen_text, beat.importantMessage.headline);

  return (
    <AbsoluteFill>
      {washFor && <Wash color={skin.wash[washFor]} kind={skin.wash.kind} cx={placed[0].cx} cy={placed[0].top + 60 * placed[0].s} />}
      {prop && <PropStage box={prop} skin={skin.prop} tag={beat.propTag} label={label} sceneImageUrl={beat.sceneImageUrl} frame={frame} reduced={reduced} tilt={skin.prop === "paper" ? 3 : 0} />}
      {placed.map((p) => (
        <React.Fragment key={p.who}>
          {skin.figureExtras && placed.length > 1 && skin.figureExtras({ who: p.who, cx: p.cx, top: p.top, s: p.s, on: p.on, level: p.on ? level : 0, frame })}
          <CastFigure cx={p.cx} top={p.top} s={p.s} dim={p.on ? 0 : skin.dimListener} transform={p.transform}>
            <CastPuppet
              who={p.who}
              variant={skin.variant}
              emotion={cta && p.who === "uco" ? "triumphant" : beat.emotion}
              mouthOpen={p.on && Boolean(talking) && !cta}
              level={p.on ? level : 0}
              frame={frame}
              globalFrame={g}
              look={look(p.who)}
              reduced={reduced}
              rim={p.on ? skin.rim[p.who] : null}
              fxColor={skin.fxColor}
            />
          </CastFigure>
        </React.Fragment>
      ))}
    </AbsoluteFill>
  );
}

function Wash({ color, kind, cx, cy }: { color: string; kind: "flat" | "glow"; cx: number; cy: number }) {
  if (kind === "flat") {
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{ backgroundColor: color, opacity: 0.55 }} />
        <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(20,22,25,0.12) 3px, transparent 3px)", backgroundSize: "26px 26px" }} />
      </AbsoluteFill>
    );
  }
  return <AbsoluteFill style={{ background: `radial-gradient(circle 760px at ${cx}px ${cy}px, ${color} 0%, transparent 70%)` }} />;
}
