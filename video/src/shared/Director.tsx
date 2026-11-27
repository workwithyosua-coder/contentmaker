import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import type { Beat } from "../beats";
import { CastPuppet, SpeedLines } from "../cast/CastPuppet";
import { OCU_FINGERTIP, type CastVariant } from "../cast/CastSvg";
import { CastFigure, HEAVY } from "../cast/CueShared";
import type { EpisodeLine } from "../types";
import { UcoOcuWordmark, WORDMARK_ASPECT } from "../brand/UcoOcuWordmark";
import { PropStage, propLabel, type Box, type PropSkin } from "./PropStage";
import type { MouthStage } from "./motion";
import { CTA_FACE, CTA_H, FRAME_BOTTOM, PAIR_H, SOLO_H, STAGE_BOTTOM, STAGE_TOP, cameoFigure, closeupFrameH, fitFrameH, headFracFor, type HeadFrac } from "./castLayout";
import { CUT_FRAMES, inverseCamera, blinkAt, ctaTapFrame, chatterStage, levelAt, mouthStage, stackColumn, TAKEOVER_HERO } from "./motion";
import { kineticAt } from "./sfxCues";
import { EvidenceStage, ExplainerCard, KineticText, PngPropStage, ThoughtBubble, kineticHeight, type LabelMode } from "./VisualStage";

// The Director lays out each beat as a camera shot over the style's background. There is no headline card: the
// characters own the middle and lower frame, and an open "visual stage" beside (solo) or above (two-shot) them
// carries the prop, explainer cards and, on emphasis beats only, 2–4 words of floating kinetic text.
//   solo-uco / solo-ocu  the speaker big (bottom on the frame edge) over a warm (Uco) or cool (Ocu) wash, stage on
//                        the open side
//   closeup-punch        the speaker's face filling the frame, with a frame-driven micro-shake
//   two-shot             both characters side by side (the listener dimmed), stage above and between them
//   cta-stinger          smaller two-shot with clear air between the heads; Ocu points along his finger into an
//                        in-video FOLLOW + pill in the upper-right safe zone (curved arrow), wordmark up top
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

/** in-video FOLLOW + button: upper-right safe zone, left of the TikTok / Reels icon rail (x ≥ 950) and under the
 *  top search bar, above Ocu's head and on his pointing side */
const FOLLOW_PILL = { x: 590, y: 600, w: 340, h: 96 } as const;
type Placed = { who: "uco" | "ocu"; cx: number; top: number; s: number; on: boolean; head: HeadOnScreen; transform?: string };

export function DirectorStage({
  beat,
  line,
  frame,
  skin,
  reduced,
  camera = NO_CAMERA,
}: {
  beat: Beat;
  line: EpisodeLine | null;
  /** frame inside the beat */
  frame: number;
  skin: DirectorSkin;
  reduced: boolean;
  /** the beat's camera move and cut slide, undone for the callout badges so they never zoom or slide off-screen */
  camera?: StageCamera;
}) {
  const shot = beat.cameraShot;
  const cta = shot === "cta-stinger";
  const g = frame + beat.startFrame;
  // smoothed voice loudness drives the mouth stage and the body; inner thoughts are silent-still
  const level = beat.thought || !line || !line.envelope.length ? 0 : levelAt(line.envelope, frame);
  const recorded = Boolean(line && line.envelope.length);
  const mouth = beat.thought || (cta && beat.line === null) ? 0 : recorded ? mouthStage(level) : reduced || cta ? 0 : chatterStage(frame);
  const tap = ctaTapFrame(beat.durationInFrames);
  const ucoOn = beat.speaker === "uco" || beat.speaker === "both";
  const ocuOn = beat.speaker === "ocu" || beat.speaker === "both";
  const emotionOf = (who: "uco" | "ocu") => (cta ? (who === "uco" ? "triumphant" : "cta") : beat.emotion);
  const label = propLabel(beat.importantMessage.stamp, line?.on_screen_text, beat.importantMessage.headline);
  const hasProp = Boolean(beat.propImage || beat.sceneImageUrl || beat.propTag !== "none" || label);
  const kinetic = beat.kinetic;
  if (beat.layout === "takeover" && !cta && !beat.thought && (hasProp || beat.stat || kinetic)) {
    return <TakeoverStage beat={beat} frame={frame} g={g} skin={skin} reduced={reduced} label={label} hasProp={hasProp} mouth={mouth} level={level} camera={camera} />;
  }

  // Figure frame height for a wanted size, kept between "hair under the stage top" and "mouth above the subtitles",
  // with the frame's bottom on the bottom of the video (no stretching: the sprite keeps its own proportions).
  const fit = fitFrameH;
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
    const c = stackColumn({ kinetic, align: kineticAlign, tilted: skin.prop === "paper", thought: beat.thought, overlay: Boolean(beat.overlay), hasProp }, col, top, bottom, propMinH);
    kineticBox = c.kineticBox;
    cardBox = c.cardBox;
    propBox = c.propBox;
    bubbleBox = c.bubbleBox;
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
    const H = closeupFrameH(f, hairMin);
    const shake = reduced ? { x: 0, y: 0 } : { x: Math.sin(frame * 1.7) * 5 + Math.sin(frame * 4.1) * 2, y: Math.cos(frame * 2.3) * 4 };
    placed = [place(who, f, H, 540 + shake.x, true, hairMin - f.hair * H + H + shake.y)];
    if (beat.thought) bubbleBox = { x: who === "uco" ? 640 : 60, y: hairMin, w: 300, h: 260 };
    // the line's prop still shows: an inset low on the open side, under the face and above the subtitles
    else if (hasProp) {
      propBox = { x: who === "uco" ? 620 : 60, y: 1100, w: 320, h: 290 }; // above the subtitles (y ≥ 1410)
      closeInset = true;
    }
    washFor = who;
  } else {
    // two-shot: one size for both, shoulders slightly overlapping, bottoms on the frame edge.
    // CTA with the pointing sprite: a smaller pair with clear air between the heads (Uco's hair reaches 287 px right
    // of his face on the 900 px sprite, Ocu's head 333 px left of his: at this scale the faces sit 460 px apart, so
    // Uco's hair never crosses Ocu's glasses), and Ocu's fingertip lands right of centre, under the FOLLOW + pill.
    const pointing = cta && O.tip;
    const H = pointing ? CTA_H : Math.min(fit(U.frac, PAIR_H), fit(O.frac, PAIR_H));
    const uco = place("uco", U.frac, H, pointing ? CTA_FACE.uco : cta ? 290 : 300, ucoOn);
    const ocu = place("ocu", O.frac, H, pointing ? CTA_FACE.ocu : cta ? 740 : 790, ocuOn);
    // the speaker stands in front; in the pointing CTA Ocu does (he's the one pointing)
    placed = ocuOn && !ucoOn && !pointing ? [uco, ocu] : pointing ? [uco, ocu] : [ocu, uco];
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

  // CTA arrow: leaves Ocu's pointing fingertip along the finger (≈ 43° up-right on the sprite) and curves onto the
  // in-video FOLLOW + pill. Without the pointing sprite: from just above his head; coded figure: from its hand.
  let arrowFrom: { x: number; y: number } | null = null;
  if (cta) {
    const o = placed.find((p) => p.who === "ocu")!;
    const w = 180 * o.s;
    const left = o.cx - w / 2;
    if (O.tip) arrowFrom = { x: left + O.tip.x * w + 10, y: o.top + O.tip.y * 340 * o.s - 10 };
    else if (O.sprite) arrowFrom = { x: o.head.cx + o.head.height * 0.3, y: Math.max(STAGE_TOP + 8, o.head.top - 30) };
    else arrowFrom = { x: left + OCU_FINGERTIP.x * o.s + 12, y: o.top + OCU_FINGERTIP.y * o.s };
  }

  // the prop itself (illustrated PNG first, then the scene image or the coded prop), in a stage box
  const propNode = (box: Box, inBubble = false) =>
    beat.propImage && !beat.sceneImageUrl ? (
      <PngPropStage name={beat.propImage} box={box} skin={skin.prop} callouts={inBubble || closeInset ? [] : beat.callouts} labels={labelMode} frame={frame} reduced={reduced} tilt={skin.prop === "paper" && !inBubble ? 3 : 0} delay={inBubble ? 10 : beat.propEntry} />
    ) : (
      <PropStage box={box} skin={skin.prop} tag={beat.propTag} label={label} sceneImageUrl={beat.sceneImageUrl} frame={frame} reduced={reduced} tilt={skin.prop === "paper" && !inBubble ? 3 : 0} delay={inBubble ? 10 : beat.propEntry} />
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
          <CastFigure cx={p.cx} top={p.top} s={p.s} dim={p.on || cta ? 0 : beat.thought ? 0.6 : skin.dimListener} transform={cta && p.who === "ocu" && !reduced ? tapNudge(frame, tap) : p.transform}>
            <CastPuppet
              who={p.who}
              variant={skin.variant}
              emotion={emotionOf(p.who)}
              mouth={p.on ? mouth : 0}
              blink={reduced ? 0 : blinkAt(`${beat.id}-${p.who}`, frame, beat.durationInFrames)}
              thought={beat.thought}
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
      {cardBox && beat.overlay && <ExplainerCard kind={beat.overlay.kind} title={beat.overlay.title} graphic={beat.overlay.graphic} box={cardBox} skin={skin.prop} frame={frame - beat.speechStart} reduced={reduced} duration={beat.durationInFrames - beat.speechStart} />}
      {propBox && propNode(propBox)}
      {bubbleBox && thinker && (
        <ThoughtBubble box={bubbleBox} toward={{ x: thinker.head.cx + (bubbleBox.x > thinker.head.cx ? 1 : -1) * thinker.head.height * 0.3, y: thinker.head.top + thinker.head.height * 0.1 }} skin={skin.prop} frame={frame} reduced={reduced} caption={beat.thoughtCaption}>
          {/* only the thought's own prop (never a text label standing in for one); else the bubble's caption */}
          {beat.propImage || beat.sceneImageUrl || beat.propTag !== "none" ? <div style={{ position: "relative", width: "100%", height: "100%" }}>{propNode({ x: 0, y: 0, w: (bubbleBox as Box).w * 0.62, h: (bubbleBox as Box).h * 0.6 }, true)}</div> : undefined}
        </ThoughtBubble>
      )}
      {kineticBox && kinetic && !cta && (
        <Uncamera camera={camera}>
          <KineticText text={kinetic} box={kineticBox} skin={skin.prop} frame={frame} reduced={reduced} align={kineticAlign} at={kineticAt(beat)} />
        </Uncamera>
      )}
      {cta && (
        <>
          <div style={{ position: "absolute", left: 540 - ctaMark / 2, top: STAGE_TOP, width: ctaMark, height: ctaMark / WORDMARK_ASPECT }}>
            <UcoOcuWordmark height={ctaMark / WORDMARK_ASPECT} />
          </div>
          {/* a custom CTA line from the direction notes sits under the wordmark; the pill always says FOLLOW + */}
          {kinetic && kinetic !== "FOLLOW +" && (
            <KineticText
              text={kinetic}
              box={{ x: 60, y: STAGE_TOP + ctaMark / WORDMARK_ASPECT + 10, w: FOLLOW_PILL.x - 60 - 24, h: FOLLOW_PILL.y + FOLLOW_PILL.h - (STAGE_TOP + ctaMark / WORDMARK_ASPECT + 10) }}
              skin={skin.prop}
              frame={frame}
              reduced={reduced}
              align="left"
            />
          )}
          <FollowPill skin={skin.prop} frame={frame} reduced={reduced} tap={tap} />
          {arrowFrom && <CtaArrow from={arrowFrom} color={skin.arrow.color} outline={skin.arrow.outline} frame={frame} reduced={reduced} tap={tap} />}
          <FollowHandle skin={skin.prop} frame={frame} reduced={reduced} tap={tap} />
        </>
      )}
      {beat.angry && <AngryVignette />}
    </AbsoluteFill>
  );
}

/** The beat's camera (zoom, tilt, shake) and the cut's slide, as applied around the 50 % / 40 % origin. */
export type StageCamera = { scale: number; rotate: number; x: number; y: number; slideX: number };
const NO_CAMERA: StageCamera = { scale: 1, rotate: 0, x: 0, y: 0, slideX: 0 };

/** Cancels the camera move and the cut slide for what's inside, so callout badges stay where they were placed. */
function Uncamera({ camera, children }: { camera: StageCamera; children: React.ReactNode }) {
  const off = camera.scale === 1 && !camera.rotate && !camera.x && !camera.y && !camera.slideX;
  return <AbsoluteFill style={off ? undefined : { transform: `${inverseCamera(camera)} translate(${-camera.slideX}px, 0px)`, transformOrigin: "50% 40%" }}>{children}</AbsoluteFill>;
}

/** Ocu leans into the tap: a quick 10 px push toward the button and back. */
function tapNudge(frame: number, tap: number) {
  const k = interpolate(frame, [tap - 6, tap, tap + 8], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return `translate(${10 * k}px, ${-8 * k}px)`;
}

const YELLOW = "#FFE600";

/**
 * The in-video FOLLOW + button (upper-right safe zone): pops in and pulses; when the arrow taps it, it presses in,
 * flips over (squash to a line and back) and lands as FOLLOWED ✔ with a burst of yellow comic accents.
 */
function FollowPill({ skin, frame, reduced, tap }: { skin: PropSkin; frame: number; reduced: boolean; tap: number }) {
  const pop = reduced ? 1 : interpolate(frame, [4, 12], [0.4, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(2)) });
  const followed = reduced || frame >= tap + 3;
  const press = reduced ? 1 : interpolate(frame, [tap - 3, tap, tap + 2], [1, 0.88, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // the flip: squash to a line over 3 frames, swap the label, open back up over 4
  const flip = reduced ? 1 : frame < tap ? 1 : frame < tap + 3 ? interpolate(frame, [tap, tap + 3], [1, 0.05]) : interpolate(frame, [tap + 3, tap + 7], [0.05, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(2.2)) });
  const pulse = reduced || frame < tap + 7 ? 1 : 1 + 0.03 * Math.sin(((frame - tap) / 30) * Math.PI * 2);
  const paper = skin === "paper";
  const { x, y, w, h } = FOLLOW_PILL;
  const fill = followed ? (paper ? "#1F8A4C" : "#14532D") : paper ? "#D9381E" : "#0F172A";
  const text = followed ? (paper ? "#FFFFFF" : "#86EFAC") : paper ? "#FFFFFF" : "#F59E0B";
  return (
    <>
      {!reduced && frame >= tap + 2 && <TapBurst cx={x + w / 2} cy={y + h / 2} frame={frame - tap - 2} paper={paper} />}
      <div
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: w,
          height: h,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: "0 16px 0 22px",
          borderRadius: h / 2,
          background: fill,
          border: paper ? "6px solid #141619" : `5px solid ${followed ? "#86EFAC" : "#F59E0B"}`,
          boxShadow: paper ? "8px 8px 0 #141619" : `0 0 24px ${followed ? "rgba(134,239,172,0.45)" : "rgba(245,158,11,0.45)"}`,
          transform: `scale(${pop * pulse * press}, ${pop * pulse * press * flip})`,
          opacity: Math.min(1, pop * 1.4),
          fontFamily: HEAVY,
          fontWeight: 900,
          fontSize: followed ? 36 : 44,
          letterSpacing: 1,
          whiteSpace: "nowrap",
          color: text,
        }}
      >
        {followed ? "FOLLOWED" : "FOLLOW"}
        <span
          aria-hidden
          style={{
            width: 52,
            height: 52,
            flexShrink: 0,
            borderRadius: 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: paper ? YELLOW : followed ? "#86EFAC" : "#F59E0B",
            color: "#141619",
            fontSize: followed ? 34 : 46,
            lineHeight: 1,
          }}
        >
          {followed ? "✔" : "+"}
        </span>
      </div>
    </>
  );
}

/** Comic accents bursting out of the button as it flips: yellow rays and three little stars, gone in ~0.5 s. */
function TapBurst({ cx, cy, frame, paper }: { cx: number; cy: number; frame: number; paper: boolean }) {
  if (frame > 16) return null;
  const t = frame / 16;
  const grow = 1 - Math.pow(1 - Math.min(1, frame / 6), 3);
  const fade = frame < 8 ? 1 : 1 - (frame - 8) / 8;
  const ink = "#141619";
  return (
    <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0 }} aria-hidden>
      <g opacity={fade}>
        {Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2 + 0.2;
          const r0 = 150 + 40 * grow;
          const r1 = r0 + 30 + 50 * grow * (i % 2 ? 0.6 : 1);
          const ry = 0.55; // the button is wide: an elliptical burst
          return (
            <line key={i} x1={cx + Math.cos(a) * r0} y1={cy + Math.sin(a) * r0 * ry} x2={cx + Math.cos(a) * r1} y2={cy + Math.sin(a) * r1 * ry} stroke={YELLOW} strokeWidth={paper ? 12 : 9} strokeLinecap="round" style={paper ? { filter: `drop-shadow(3px 3px 0 ${ink})` } : undefined} />
          );
        })}
        {[
          [-0.95, -1.1],
          [0.9, -1.25],
          [-0.2, 1.35],
        ].map(([dx, dy], i) => {
          const sx = cx + dx * (190 + 30 * t);
          const sy = cy + dy * (60 + 20 * t);
          const r = 18 * grow;
          const star = Array.from({ length: 10 }, (_, k) => {
            const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
            const rr = k % 2 ? r * 0.45 : r;
            return `${(sx + Math.cos(a) * rr).toFixed(1)},${(sy + Math.sin(a) * rr).toFixed(1)}`;
          }).join(" ");
          return <polygon key={i} points={star} fill={YELLOW} stroke={ink} strokeWidth={4} strokeLinejoin="round" />;
        })}
      </g>
    </svg>
  );
}

/** The channel handle under the button, once it reads FOLLOWED ✔ (the arrow has faded out of that spot by then). */
function FollowHandle({ skin, frame, reduced, tap }: { skin: PropSkin; frame: number; reduced: boolean; tap: number }) {
  const k = reduced ? 1 : interpolate(frame, [tap + 6, tap + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (!k) return null;
  const paper = skin === "paper";
  return (
    <div
      style={{
        position: "absolute",
        left: FOLLOW_PILL.x - 20,
        width: FOLLOW_PILL.w + 40,
        top: FOLLOW_PILL.y + FOLLOW_PILL.h + 22 + (1 - k) * 12,
        textAlign: "center",
        opacity: k,
        fontFamily: HEAVY,
        fontWeight: 900,
        fontSize: 42,
        letterSpacing: 1,
        color: paper ? "#FFFFFF" : "#F59E0B",
        WebkitTextStroke: paper ? "8px #141619" : undefined,
        paintOrder: "stroke fill",
        textShadow: paper ? "0 4px 0 #141619" : "0 0 14px rgba(245,158,11,0.5)",
      }}
    >
      @uco.ocu
    </div>
  );
}

/** Horizontal speed streaks across the frame during the 4-frame whip cut, trailing the move. */
export function WhipStreaks({ dir, frame, color }: { dir: -1 | 0 | 1; frame: number; color: string }) {
  if (!dir || frame >= CUT_FRAMES) return null;
  const o = 0.55 * (1 - frame / CUT_FRAMES);
  return (
    <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, opacity: o }} aria-hidden>
      {Array.from({ length: 9 }, (_, i) => {
        const y = 300 + i * 120 + ((i * 37) % 50);
        const len = 260 + ((i * 113) % 300);
        const x0 = dir > 0 ? 1080 - ((i * 71) % 400) - len : (i * 71) % 400;
        return <line key={i} x1={x0} y1={y} x2={x0 + len} y2={y} stroke={color} strokeWidth={i % 3 ? 6 : 10} strokeLinecap="round" />;
      })}
    </svg>
  );
}

/**
 * The CTA arrow: a curve that leaves the fingertip along the finger (≈ 43° up-right), swings up and lands on the
 * bottom of the FOLLOW + pill, drawn on over frames 10–24 with its head aligned to the curve's end.
 */
function CtaArrow({ from, color, outline, frame, reduced, tap }: { from: { x: number; y: number }; color: string; outline: string; frame: number; reduced: boolean; tap: number }) {
  const progress = reduced ? 1 : interpolate(frame, [10, 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  // the tap: the head pulls back a little, jabs into the button's edge, then the arrow fades so the handle can show
  const jab = reduced ? 0 : interpolate(frame, [tap - 8, tap - 4, tap, tap + 3], [0, -14, 22, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fade = reduced ? 0 : interpolate(frame, [tap + 4, tap + 10], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (fade <= 0) return null;
  const to = { x: FOLLOW_PILL.x + FOLLOW_PILL.w * 0.62, y: FOLLOW_PILL.y + FOLLOW_PILL.h + 18 - jab };
  const dir = { x: Math.cos((43 * Math.PI) / 180), y: -Math.sin((43 * Math.PI) / 180) };
  const reach = Math.max(80, Math.min(160, (from.y - to.y) * 0.35));
  const c1 = { x: Math.min(930, from.x + dir.x * reach), y: from.y + dir.y * reach };
  const c2 = { x: Math.min(930, to.x + 40), y: to.y + (from.y - to.y) * 0.45 };
  const at = (t: number) => {
    const u = 1 - t;
    return {
      x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
      y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
    };
  };
  // sample the curve up to `progress` so it draws on; the head follows the tangent at the drawn end
  const n = 40;
  const pts = Array.from({ length: Math.max(2, Math.round(n * progress) + 1) }, (_, i) => at(Math.min(progress, i / n)));
  const end = pts[pts.length - 1];
  const prev = at(Math.max(0, progress - 0.02));
  const ang = Math.atan2(end.y - prev.y, end.x - prev.x);
  const head = 40;
  const p1 = { x: end.x - head * Math.cos(ang - 0.5), y: end.y - head * Math.sin(ang - 0.5) };
  const p2 = { x: end.x - head * Math.cos(ang + 0.5), y: end.y - head * Math.sin(ang + 0.5) };
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const hd = `M${p1.x} ${p1.y} L${end.x} ${end.y} L${p2.x} ${p2.y}`;
  return (
    <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, opacity: fade }} aria-hidden>
      <path d={d} fill="none" stroke={outline} strokeWidth={24} strokeLinecap="round" strokeLinejoin="round" />
      {progress > 0.05 && <path d={hd} fill="none" stroke={outline} strokeWidth={24} strokeLinecap="round" strokeLinejoin="round" />}
      <path d={d} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" />
      {progress > 0.05 && <path d={hd} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
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

/** Angry delivery: a dark-red edge vignette (the centre, faces and text stay clear). */
function AngryVignette() {
  return <AbsoluteFill style={{ pointerEvents: "none", background: "radial-gradient(ellipse 78% 62% at 50% 46%, transparent 56%, rgba(120,10,10,0.52) 100%)" }} />;
}

/**
 * Evidence Takeover: the prop and / or stat card centre stage (70 % of the canvas width, y 340..1160) and the speaker
 * in a framed corner cameo (Uco lower-left, Ocu lower-right, ending at y 1500, clear of the subtitles at 1540+),
 * still lip-syncing, blinking and bouncing with the voice.
 */
function TakeoverStage({ beat, frame, g, skin, reduced, label, hasProp, mouth, level, camera }: { beat: Beat; frame: number; g: number; skin: DirectorSkin; reduced: boolean; label: string | null; hasProp: boolean; mouth: MouthStage; level: number; camera: StageCamera }) {
  const who = beat.speaker === "ocu" ? "ocu" : "uco";
  const at = beat.speechStart;
  const stat = beat.stat ?? (!hasProp && beat.kinetic ? { headline: beat.kinetic, subline: null } : null);
  // head-and-shoulders framing from the pose's calibration (uploads are framed to it too): never sunk or tiny
  const { box, s, w, left, top } = cameoFigure(who, beat.emotion);
  const cameoPop = reduced ? 1 : interpolate(frame, [0, 6], [0.85, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(2)) });
  const paper = skin.prop === "paper";
  return (
    <AbsoluteFill>
      <EvidenceStage hero={TAKEOVER_HERO} skin={skin.prop} frame={frame} duration={beat.durationInFrames} at={at} stat={stat} reduced={reduced}>
        {hasProp
          ? (pb) =>
              beat.propImage && !beat.sceneImageUrl ? (
                <PngPropStage name={beat.propImage} box={pb} skin={skin.prop} callouts={beat.callouts} labels="sides" frame={frame} reduced={reduced} delay={beat.propEntry} />
              ) : (
                <PropStage box={pb} skin={skin.prop} tag={beat.propTag} label={label} sceneImageUrl={beat.sceneImageUrl} frame={frame} reduced={reduced} tilt={0} delay={beat.propEntry} />
              )
          : undefined}
      </EvidenceStage>
      <div
        style={{
          position: "absolute",
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          boxSizing: "border-box",
          overflow: "hidden",
          background: skin.wash[who],
          border: paper ? "6px solid #141619" : `3px solid ${who === "uco" ? "#F59E0B" : "#38BDF8"}`,
          boxShadow: paper ? "8px 8px 0 #141619" : skin.rim[who] ? `0 0 16px ${skin.rim[who]}` : undefined,
          borderRadius: paper ? 4 : 6,
          transform: `scale(${cameoPop})`,
          transformOrigin: who === "uco" ? "0% 100%" : "100% 100%",
        }}
      >
        <CastFigure cx={left + w / 2} top={top} s={s}>
          <CastPuppet
            who={who}
            variant={skin.variant}
            emotion={beat.emotion}
            mouth={mouth}
            blink={reduced ? 0 : blinkAt(`${beat.id}-${who}`, frame, beat.durationInFrames)}
            thought={false}
            level={level}
            frame={frame}
            globalFrame={g}
            look={0}
            reduced={reduced}
            rim={null}
            fx="none"
          />
        </CastFigure>
      </div>
      {/* the line's on-screen callout, stamped across the top of the evidence frame */}
      {stat === beat.stat && beat.kinetic && (
        <Uncamera camera={camera}>
          <KineticText
            text={beat.kinetic}
            box={{ x: TAKEOVER_HERO.x - 20, y: TAKEOVER_HERO.y - 66, w: TAKEOVER_HERO.w + 40, h: 120 }}
            skin={skin.prop}
            frame={frame}
            reduced={reduced}
            align="center"
            at={at}
          />
        </Uncamera>
      )}
      {beat.angry && <AngryVignette />}
    </AbsoluteFill>
  );
}
