import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { castSprites } from "../assets";
import { SAFE_ZONE, type Beat } from "../beats";
import { CastPuppet } from "../cast/CastPuppet";
import { OCU_FINGERTIP, mouthOpenAt, type CastVariant } from "../cast/CastSvg";
import { headBoxFor } from "../cast/spriteCalibration";
import { CastFigure, FollowArrow, FollowTarget, SafeFrame, toFrame } from "../cast/CueShared";
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
  /** CTA arrow (to TikTok's + Follow) and the target ring */
  arrow: { color: string; outline: string; ring: string };
  /** extra graphics per figure in two-shots (e.g. HUD brackets and voice meters), drawn on the full canvas */
  figureExtras?: (f: { who: "uco" | "ocu"; head: HeadOnScreen; on: boolean; level: number; frame: number }) => React.ReactNode;
};

/** Where a figure's head ended up on the canvas (px). */
export type HeadOnScreen = { cx: number; top: number; chin: number; height: number };

// Where the head sits inside a figure's frame, as fractions of the frame (sprite: measured; coded SVG: its drawing).
type HeadFrac = { hair: number; chin: number; mouth: number; faceX: number };
const SVG_HEAD: HeadFrac = { hair: 8 / 340, chin: 104 / 340, mouth: 86 / 340, faceX: 0.5 };
function headFracFor(who: "uco" | "ocu", emotion: string): { frac: HeadFrac; sprite: boolean; tip: { x: number; y: number } | null } {
  const sp = castSprites(who, emotion);
  if (!sp) return { frac: SVG_HEAD, sprite: false, tip: null };
  const h = headBoxFor(who, sp.emotion);
  return {
    frac: { hair: h.hairTop / 1700, chin: h.chin / 1700, mouth: (h.hairTop + 0.8 * (h.chin - h.hairTop)) / 1700, faceX: h.faceX / 900 },
    sprite: true,
    // fingertip as fractions of the figure frame
    tip: h.fingertip && sp.emotion === emotion ? { x: h.fingertip.x / 900, y: h.fingertip.y / 1700 } : null,
  };
}

const FRAME_BOTTOM = 1920;
/** mouths stay above the movie subtitles (y 1120..1250) */
const MOUTH_MAX_Y = 1100;

type Placed = { who: "uco" | "ocu"; cx: number; top: number; s: number; on: boolean; head: HeadOnScreen; transform?: string };

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
  const emotionOf = (who: "uco" | "ocu") => (cta ? (who === "uco" ? "triumphant" : "cta") : beat.emotion);
  const hairMin = cardBottom + 22; // hair never goes under the headline card

  // Figure frame height for a wanted size, kept between "hair just under the card" and "mouth above the subtitles",
  // with the frame's bottom on the bottom of the video (no stretching: the sprite keeps its own proportions).
  const fit = (f: HeadFrac, want: number) => {
    const hMax = (FRAME_BOTTOM - hairMin) / (1 - f.hair);
    const hMin = (FRAME_BOTTOM - MOUTH_MAX_Y) / (1 - f.mouth);
    return Math.max(hMin, Math.min(want, hMax));
  };
  /** a figure whose frame is `H` tall, bottom at `bottom`, face centred on `faceX` */
  const place = (who: "uco" | "ocu", f: HeadFrac, H: number, faceX: number, on: boolean, bottom = FRAME_BOTTOM, transform?: string): Placed => {
    const s = H / 340;
    const w = 180 * s;
    const top = bottom - H;
    const left = faceX - f.faceX * w;
    return { who, cx: left + w / 2, top, s, on, transform, head: { cx: faceX, top: top + f.hair * H, chin: top + f.chin * H, height: (f.chin - f.hair) * H } };
  };

  let placed: Placed[];
  let prop: Box | null = null;
  let washFor: "uco" | "ocu" | null = null;
  const U = headFracFor("uco", emotionOf("uco"));
  const O = headFracFor("ocu", emotionOf("ocu"));

  if (shot === "solo-uco" || shot === "solo-ocu") {
    // natural medium shot: as big as the card and subtitles allow, bottom on the frame edge, slightly off-centre
    const who = shot === "solo-uco" ? "uco" : "ocu";
    const f = who === "uco" ? U.frac : O.frac;
    const intense = who === "uco" && (beat.emotion === "triumphant" || beat.emotion === "shocked");
    placed = [place(who, f, fit(f, 1800), who === "uco" ? 380 : 700, true, FRAME_BOTTOM, intense && !reduced ? "rotate(-3deg)" : undefined)];
    // topic prop in the open upper space on the other side
    const y = Math.min(700, Math.max(540, hairMin));
    prop = who === "uco" ? { x: 590, y, w: 340, h: 960 - y } : { x: 70, y, w: 340, h: 960 - y };
    washFor = who;
  } else if (shot === "closeup-punch") {
    const who = beat.speaker === "ocu" ? "ocu" : "uco";
    const f = who === "uco" ? U.frac : O.frac;
    // the head fills the space between the card and the subtitles (the chin may dip behind them; the mouth may not)
    const mouthInHead = (f.mouth - f.hair) / (f.chin - f.hair);
    const headPx = (MOUTH_MAX_Y - hairMin) / mouthInHead;
    const H = headPx / (f.chin - f.hair);
    const shake = reduced ? { x: 0, y: 0 } : { x: Math.sin(frame * 1.7) * 5 + Math.sin(frame * 4.1) * 2, y: Math.cos(frame * 2.3) * 4 };
    placed = [place(who, f, H, 540 + shake.x, true, hairMin - f.hair * H + H + shake.y)];
    washFor = who;
  } else {
    // two-shot / CTA: one size for both, shoulders slightly overlapping, bottoms on the frame edge
    const H = Math.min(fit(U.frac, 1320), fit(O.frac, 1320));
    // CTA with a pointing sprite: Ocu nearer the centre (Uco half behind him on the left) so the arrow can leave his
    // fingertip up-right into + Follow without crossing a face
    const pointing = cta && O.tip;
    const uco = place("uco", U.frac, H, pointing ? 175 : cta ? 290 : 300, ucoOn);
    const ocu = place("ocu", O.frac, H, pointing ? 500 : cta ? 740 : 790, ocuOn);
    // the speaker stands in front; in the pointing CTA Uco does (he only overlaps Ocu's folded arm, not the hand)
    placed = ocuOn && !ucoOn && !pointing ? [uco, ocu] : [ocu, uco];
  }

  const look = (who: "uco" | "ocu") => (cta || placed.length === 1 ? 0 : who === "uco" ? (ocuOn && !ucoOn ? 1 : 0.4) : ucoOn && !ocuOn ? -1 : -0.4);
  const label = propLabel(beat.importantMessage.stamp, line?.on_screen_text, beat.importantMessage.headline);

  // CTA arrow: from Ocu's pointing fingertip (sprite or coded figure), else from just above his head
  let arrowFrom: { x: number; y: number } | null = null;
  if (cta) {
    const o = placed.find((p) => p.who === "ocu")!;
    const w = 180 * o.s;
    const left = o.cx - w / 2;
    if (O.tip) {
      // from his pointing fingertip, a little clear of the nail, toward + Follow
      const tx = left + O.tip.x * w;
      const ty = o.top + O.tip.y * 340 * o.s;
      const dx = SAFE_ZONE.followX - tx;
      const dy = SAFE_ZONE.followY - ty;
      const len = Math.hypot(dx, dy) || 1;
      arrowFrom = { x: tx + (dx / len) * 14, y: ty + (dy / len) * 14 };
    } else if (O.sprite) {
      // no pointing sprite: from just above his hair (under the card), sweeping down-right into + Follow
      arrowFrom = { x: o.head.cx - o.head.height * 0.1, y: Math.min(SAFE_ZONE.followY - 60, Math.max(hairMin + 8, o.head.top - 40)) };
    } else {
      // coded figure: from its raised pointing hand
      arrowFrom = { x: left + OCU_FINGERTIP.x * o.s + 12, y: o.top + OCU_FINGERTIP.y * o.s };
    }
  }

  return (
    <AbsoluteFill>
      {washFor && <Wash color={skin.wash[washFor]} kind={skin.wash.kind} cx={placed[0].head.cx} cy={placed[0].head.top + placed[0].head.height / 2} />}
      {prop && <PropStage box={prop} skin={skin.prop} tag={beat.propTag} label={label} sceneImageUrl={beat.sceneImageUrl} frame={frame} reduced={reduced} tilt={skin.prop === "paper" ? 3 : 0} />}
      {placed.map((p) => (
        <React.Fragment key={p.who}>
          {skin.figureExtras && placed.length > 1 && skin.figureExtras({ who: p.who, head: p.head, on: p.on, level: p.on ? level : 0, frame })}
          <CastFigure cx={p.cx} top={p.top} s={p.s} dim={p.on ? 0 : skin.dimListener} transform={p.transform}>
            <CastPuppet
              who={p.who}
              variant={skin.variant}
              emotion={emotionOf(p.who)}
              mouthOpen={p.on && Boolean(talking) && !cta}
              level={p.on ? level : 0}
              frame={frame}
              globalFrame={g}
              look={look(p.who)}
              reduced={reduced}
              rim={p.on ? skin.rim[p.who] : null}
              fxColor={skin.fxColor}
              fx={p.on ? (placed.length === 1 ? "all" : "sweat") : "none"}
            />
          </CastFigure>
        </React.Fragment>
      ))}
      {arrowFrom && (
        <SafeFrame>
          <FollowArrow
            from={toFrame(arrowFrom)}
            color={skin.arrow.color}
            outline={skin.arrow.outline}
            progress={reduced ? 1 : interpolate(frame, [10, 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })}
          />
          <FollowTarget color={skin.arrow.ring} scale={reduced ? 1 : 1 + 0.15 * Math.sin((frame / 30) * Math.PI * 2)} />
        </SafeFrame>
      )}
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
