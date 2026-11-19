import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { castSprites } from "../assets";
import { SAFE_ZONE, type Beat } from "../beats";
import { CastPuppet, SpeedLines } from "../cast/CastPuppet";
import { OCU_FINGERTIP, mouthOpenAt, type CastVariant } from "../cast/CastSvg";
import { headBoxFor } from "../cast/spriteCalibration";
import { CastFigure, FollowArrow, FollowTarget, SafeFrame, toFrame } from "../cast/CueShared";
import type { EpisodeLine } from "../types";
import { UcoOcuWordmark, WORDMARK_ASPECT } from "../brand/UcoOcuWordmark";
import { PropStage, propLabel, type Box, type PropSkin } from "./PropStage";
import { ExplainerCard, KineticText, PngPropStage, ThoughtBubble, kineticHeight, type LabelMode } from "./VisualStage";

// The Director lays out each beat as a camera shot over the style's background. There is no headline card: the
// characters own the middle and lower frame, and an open "visual stage" beside (solo) or above (two-shot) them
// carries the prop, explainer cards and, on emphasis beats only, 2–4 words of floating kinetic text.
//   solo-uco / solo-ocu  the speaker big (bottom on the frame edge) over a warm (Uco) or cool (Ocu) wash, stage on
//                        the open side
//   closeup-punch        the speaker's face filling the frame, with a frame-driven micro-shake
//   two-shot             both characters side by side (the listener dimmed), stage above and between them
//   cta-stinger          two-shot, Ocu pointing at TikTok's + Follow (x 920, y 780), wordmark + stamp up top
//   thought lines        dimmed backdrop, the thinker lit, a comic thought bubble with the prop inside
// Layers, back to front: background wash → speed lines → (thought dim) → cast → stage (props, cards, labels, text).
// Faces always end above y 1100 (above TikTok's caption area; subtitles sit far lower, y 1480..1620); the stage stays
// in x 60..940, y 274..1080.

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
/** highest point for hair and stage items: just inside the TikTok top bar */
const STAGE_TOP = SAFE_ZONE.top + 24;
const STAGE_BOTTOM = 1080;
/** solo medium shot: figure frame height (≈1.2× the old card-limited framing), never stretched */
const SOLO_H = 1760;
/** two-shot / CTA figure frame height */
const PAIR_H = 1440;
/** mouths stay above TikTok's caption area (y 1260+), and so far above the subtitles (y 1480..1620) */
const MOUTH_MAX_Y = 1100;

type Placed = { who: "uco" | "ocu"; cx: number; top: number; s: number; on: boolean; head: HeadOnScreen; transform?: string };

export function DirectorStage({
  beat,
  line,
  frame,
  skin,
  reduced,
}: {
  beat: Beat;
  line: EpisodeLine | null;
  /** frame inside the beat */
  frame: number;
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
  const label = propLabel(beat.importantMessage.stamp, line?.on_screen_text, beat.importantMessage.headline);
  const hasProp = Boolean(beat.propImage || beat.sceneImageUrl || beat.propTag !== "none" || label);
  const kinetic = beat.kinetic;

  // Figure frame height for a wanted size, kept between "hair under the stage top" and "mouth above the subtitles",
  // with the frame's bottom on the bottom of the video (no stretching: the sprite keeps its own proportions).
  const fit = (f: HeadFrac, want: number, hairMin = STAGE_TOP) => {
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
  let washFor: "uco" | "ocu" | null = null;
  // stage boxes (canvas px): kinetic text, explainer card, prop, thought bubble
  let kineticBox: Box | null = null;
  let kineticAlign: "left" | "center" | "right" = "center";
  let labelMode: LabelMode = "sides";
  /** close-up prop inset: no callout labels (they'd run over the face or the subtitles) */
  let closeInset = false;
  let cardBox: Box | null = null;
  let propBox: Box | null = null;
  let bubbleBox: Box | null = null;
  const U = headFracFor("uco", emotionOf("uco"));
  const O = headFracFor("ocu", emotionOf("ocu"));

  /** Stacks kinetic text, card and prop top-down in one column (thought lines put the prop in a bubble instead). */
  const stack = (col: { x: number; w: number }, top: number, bottom: number, propMinH = 300) => {
    // space goes to the prop first, then the kinetic text, then the explainer card (dropped when it doesn't fit)
    const kh = kinetic ? kineticHeight(kinetic, col.w) + 8 : 0;
    const showKinetic = Boolean(kinetic) && (beat.thought || !hasProp || bottom - top - kh >= propMinH);
    let y = top;
    if (showKinetic && kinetic) {
      kineticBox = { x: col.x, y, w: col.w, h: kh - 8 };
      y += kh;
    }
    if (beat.thought) {
      bubbleBox = { x: col.x, y, w: col.w, h: Math.min(bottom - y, col.w * 0.95) };
      return;
    }
    if (beat.overlay) {
      const free = bottom - y - (hasProp ? propMinH : 0);
      const h = hasProp ? Math.min(300, free - 22) : Math.min(col.w * 1.15, bottom - y);
      if (h >= 200) {
        cardBox = { x: col.x, y, w: col.w, h };
        y += h + 22;
      }
    }
    if (hasProp) propBox = { x: col.x, y, w: col.w, h: Math.max(propMinH, bottom - y) };
  };

  if (shot === "solo-uco" || shot === "solo-ocu") {
    // big medium shot: bottom on the frame edge, face off-centre, the stage column on the open side
    const who = shot === "solo-uco" ? "uco" : "ocu";
    const f = who === "uco" ? U.frac : O.frac;
    const intense = !beat.thought && who === "uco" && (beat.emotion === "triumphant" || beat.emotion === "shocked");
    placed = [place(who, f, fit(f, SOLO_H), who === "uco" ? 350 : 740, true, FRAME_BOTTOM, intense && !reduced ? "rotate(-3deg)" : undefined)];
    const col = who === "uco" ? { x: 600, w: 340 } : { x: 60, w: 340 };
    kineticAlign = who === "uco" ? "right" : "left";
    labelMode = who === "uco" ? "below-right" : "below-left";
    stack(col, STAGE_TOP, STAGE_BOTTOM);
    washFor = who;
  } else if (shot === "closeup-punch") {
    const who = beat.speaker === "ocu" ? "ocu" : "uco";
    const f = who === "uco" ? U.frac : O.frac;
    const kh = kinetic ? kineticHeight(kinetic, 820) : 0;
    const hairMin = STAGE_TOP + (kh ? kh + 10 : 0);
    if (kinetic) kineticBox = { x: 130, y: STAGE_TOP, w: 820, h: kh };
    // the head fills the space between the stage top and the subtitles (the chin may dip behind them; the mouth may not)
    const mouthInHead = (f.mouth - f.hair) / (f.chin - f.hair);
    const headPx = (MOUTH_MAX_Y - hairMin) / mouthInHead;
    const H = headPx / (f.chin - f.hair);
    const shake = reduced ? { x: 0, y: 0 } : { x: Math.sin(frame * 1.7) * 5 + Math.sin(frame * 4.1) * 2, y: Math.cos(frame * 2.3) * 4 };
    placed = [place(who, f, H, 540 + shake.x, true, hairMin - f.hair * H + H + shake.y)];
    if (beat.thought) bubbleBox = { x: who === "uco" ? 640 : 60, y: hairMin, w: 300, h: 260 };
    // the line's prop still shows: an inset low on the open side, under the face and above the subtitles
    else if (hasProp) {
      propBox = { x: who === "uco" ? 620 : 60, y: 1110, w: 320, h: 350 };
      closeInset = true;
    }
    washFor = who;
  } else {
    // two-shot / CTA: one size for both, shoulders slightly overlapping, bottoms on the frame edge
    const H = Math.min(fit(U.frac, PAIR_H), fit(O.frac, PAIR_H));
    // CTA with a pointing sprite: Ocu nearer the centre (Uco half behind him on the left) so the arrow can leave his
    // fingertip up-right into + Follow without crossing a face
    const pointing = cta && O.tip;
    const uco = place("uco", U.frac, H, pointing ? 175 : cta ? 290 : 300, ucoOn);
    const ocu = place("ocu", O.frac, H, pointing ? 500 : cta ? 740 : 790, ocuOn);
    // the speaker stands in front; in the pointing CTA Uco does (he only overlaps Ocu's folded arm, not the hand)
    placed = ocuOn && !ucoOn && !pointing ? [uco, ocu] : [ocu, uco];
    const hairTop = Math.min(uco.head.top, ocu.head.top);
    if (!cta) {
      if (beat.thought) {
        // the bubble rises over the thinker's head
        const thinker = beat.speaker === "ocu" ? ocu : uco;
        const w = 360;
        bubbleBox = { x: Math.min(940 - w, Math.max(60, thinker.head.cx - w / 2 + (beat.speaker === "ocu" ? -40 : 40))), y: STAGE_TOP, w, h: Math.max(220, hairTop - STAGE_TOP - 20) };
      } else stack({ x: 230, w: 620 }, STAGE_TOP, hairTop + 40, 200);
    }
  }

  const look = (who: "uco" | "ocu") => (cta || placed.length === 1 ? 0 : who === "uco" ? (ocuOn && !ucoOn ? 1 : 0.4) : ucoOn && !ocuOn ? -1 : -0.4);
  const speaker = placed.find((p) => p.on) ?? placed[0];
  const energetic = !cta && !beat.thought && placed.length === 1 && speaker.who === "uco" && (beat.emotion === "triumphant" || beat.emotion === "shocked");

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
      // no pointing sprite: from just above his hair, sweeping down-right into + Follow
      arrowFrom = { x: o.head.cx - o.head.height * 0.1, y: Math.min(SAFE_ZONE.followY - 60, Math.max(STAGE_TOP + 8, o.head.top - 40)) };
    } else {
      // coded figure: from its raised pointing hand
      arrowFrom = { x: left + OCU_FINGERTIP.x * o.s + 12, y: o.top + OCU_FINGERTIP.y * o.s };
    }
  }

  // the prop itself (illustrated PNG first, then the scene image or the coded prop), in a stage box
  const propNode = (box: Box, inBubble = false) =>
    beat.propImage && !beat.sceneImageUrl ? (
      <PngPropStage name={beat.propImage} box={box} skin={skin.prop} callouts={inBubble || closeInset ? [] : beat.callouts} labels={labelMode} frame={frame} reduced={reduced} tilt={skin.prop === "paper" && !inBubble ? 3 : 0} delay={inBubble ? 10 : 6} />
    ) : (
      <PropStage box={box} skin={skin.prop} tag={beat.propTag} label={label} sceneImageUrl={beat.sceneImageUrl} frame={frame} reduced={reduced} tilt={skin.prop === "paper" && !inBubble ? 3 : 0} />
    );
  const thinker = beat.thought ? speaker : null;
  const ctaMark = cta ? Math.min(820, 150 * WORDMARK_ASPECT) : 0;

  return (
    <AbsoluteFill>
      {washFor && <Wash color={skin.wash[washFor]} kind={skin.wash.kind} cx={placed[0].head.cx} cy={placed[0].head.top + placed[0].head.height / 2} />}
      {/* speed lines: background layer, behind the cast and every prop, card and label */}
      {energetic && <SpeedLines cx={speaker.head.cx} cy={speaker.head.top + speaker.head.height * 0.45} r={speaker.head.height * 0.62} color={skin.fxColor} frame={g} reduced={reduced} />}
      {/* thought-bubble mode: everything behind the thinker dims */}
      {beat.thought && <AbsoluteFill style={{ backgroundColor: skin.prop === "paper" ? "rgba(20,22,25,0.55)" : "rgba(2,6,23,0.6)" }} />}
      {placed.map((p) => (
        <React.Fragment key={p.who}>
          {skin.figureExtras && placed.length > 1 && skin.figureExtras({ who: p.who, head: p.head, on: p.on, level: p.on ? level : 0, frame })}
          <CastFigure cx={p.cx} top={p.top} s={p.s} dim={p.on ? 0 : beat.thought ? 0.6 : skin.dimListener} transform={p.transform}>
            <CastPuppet
              who={p.who}
              variant={skin.variant}
              emotion={emotionOf(p.who)}
              mouthOpen={p.on && Boolean(talking) && !cta && !beat.thought}
              level={p.on ? level : 0}
              frame={frame}
              globalFrame={g}
              look={look(p.who)}
              reduced={reduced}
              rim={p.on ? skin.rim[p.who] : null}
              fx={p.on ? "sweat" : "none"}
            />
          </CastFigure>
        </React.Fragment>
      ))}
      {/* the visual stage, in front of the cast */}
      {cardBox && beat.overlay && <ExplainerCard kind={beat.overlay.kind} title={beat.overlay.title} box={cardBox} skin={skin.prop} frame={frame} reduced={reduced} />}
      {propBox && propNode(propBox)}
      {bubbleBox && thinker && (
        <ThoughtBubble box={bubbleBox} toward={{ x: thinker.head.cx + (bubbleBox.x > thinker.head.cx ? 1 : -1) * thinker.head.height * 0.3, y: thinker.head.top + thinker.head.height * 0.1 }} skin={skin.prop} frame={frame} reduced={reduced}>
          {hasProp ? <div style={{ position: "relative", width: "100%", height: "100%" }}>{propNode({ x: 0, y: 0, w: (bubbleBox as Box).w * 0.62, h: (bubbleBox as Box).h * 0.6 }, true)}</div> : undefined}
        </ThoughtBubble>
      )}
      {kineticBox && kinetic && !cta && <KineticText text={kinetic} box={kineticBox} skin={skin.prop} frame={frame} reduced={reduced} align={kineticAlign} />}
      {cta && (
        <>
          <div style={{ position: "absolute", left: 540 - ctaMark / 2, top: STAGE_TOP, width: ctaMark, height: ctaMark / WORDMARK_ASPECT }}>
            <UcoOcuWordmark height={ctaMark / WORDMARK_ASPECT} />
          </div>
          {kinetic && <KineticText text={kinetic} box={{ x: 140, y: STAGE_TOP + ctaMark / WORDMARK_ASPECT + 6, w: 800, h: 140 }} skin={skin.prop} frame={frame} reduced={reduced} />}
        </>
      )}
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
