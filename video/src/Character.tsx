import React from "react";
import { random } from "remotion";
import { COLORS, type Expression, type Speaker } from "./types";

// Uco & Ocu rigs, per the style bible:
// - bold, slightly irregular ink outlines that "boil" (re-jitter every 3 frames, limited-animation style)
// - Ben-Day / halftone dot shading
// - Uco: spiky dark hair, oversized angular glasses, frantic eyes, gaping yelling mouth, orange shirt, leans forward
// - Ocu: messy flat hair, huge round glasses, heavy half-lidded eyes, flat smirk, stubble, grey tee, slouched, holds a drink
// Drawn in a 600 x 820 box (head + chest); the body continues below for tall frames.

type Face = {
  brow: number; // degrees, + = inner ends up (worried), - = inner ends down (angry)
  browY: number; // px, - = raised
  lid: number; // 0 = eyes wide open, 1 = closed
  curve: number; // mouth corners, -1 frown .. 1 smile
  pupil: number; // pupil scale
  shake: number; // px of jitter while talking
  blush: number; // 0..1 red cheeks
  tilt: number; // head tilt in degrees
  asym?: boolean; // one corner of the mouth up (smirk)
};

// 8 expression swaps per character.
const FACES: Record<string, Face> = {
  deadpan: { brow: 0, browY: 6, lid: 0.5, curve: 0.1, pupil: 0.85, shake: 0, blush: 0, tilt: -2, asym: true },
  calm: { brow: 4, browY: 0, lid: 0.4, curve: 0.2, pupil: 0.9, shake: 0, blush: 0, tilt: -3, asym: true },
  worried: { brow: 18, browY: -8, lid: 0.15, curve: -0.55, pupil: 0.7, shake: 1, blush: 0, tilt: 4 },
  angry: { brow: -24, browY: 8, lid: 0, curve: -0.5, pupil: 0.55, shake: 4, blush: 0.5, tilt: 0 },
  furious: { brow: -32, browY: 12, lid: 0, curve: -0.7, pupil: 0.42, shake: 8, blush: 1, tilt: 0 },
  excited: { brow: 12, browY: -16, lid: 0, curve: 0.9, pupil: 0.8, shake: 3, blush: 0.3, tilt: -4 },
  thinking: { brow: 10, browY: -2, lid: 0.35, curve: -0.25, pupil: 0.8, shake: 0, blush: 0, tilt: 6 },
  smug: { brow: -8, browY: 2, lid: 0.45, curve: 0.45, pupil: 0.85, shake: 0, blush: 0.15, tilt: -5, asym: true },
};
export const faceFor = (e: Expression) => FACES[e] ?? FACES.calm;

const LOOK = {
  uco: { skin: "#C98E62", shade: "#9E6A43", hair: "#17161C", hairHi: "#3B3A48" },
  ocu: { skin: "#B4AC9C", shade: "#857E70", hair: "#1A1C22", hairHi: "#3A4150" }, // cool, washed-out under slate light
};

const INK = COLORS.ink;
const S = 8; // outline width

export function Character({
  who,
  expression,
  mouth,
  frame,
  talking,
  look = 0,
  props = true,
  drink = "#8DB255",
  gesture = "hold",
  gt = 0,
  glen = 90,
}: {
  who: Speaker;
  expression: Expression;
  /** 0..1 mouth openness for this frame. */
  mouth: number;
  frame: number;
  talking: boolean;
  /** Where the pupils point: -1 left .. 1 right. */
  look?: number;
  /** Draw the expression extras (anger vein, sweat drops). */
  props?: boolean;
  /** Color of Ocu's iced drink; null = hands tucked away. */
  drink?: string | null;
  /** Arm acting for this line, timed by gt (frame within the line) and glen (line length). */
  gesture?: Gesture;
  gt?: number;
  glen?: number;
}) {
  const f = faceFor(expression);
  const c = LOOK[who];
  const isOcu = who === "ocu";
  const id = `${who}-${Math.round(random(who) * 1e6)}`;
  const boil = Math.floor(frame / 3); // new line wobble every 3 frames

  // Idle: Ocu breathes slow and shallow; Uco fast. Ocu barely nods.
  const breathe = isOcu ? Math.sin(frame / 30) * 3 : Math.sin(frame / 12) * 5;
  const blinkCycle = isOcu ? 131 : 83;
  const blinkAt = (frame + (isOcu ? 40 : 0)) % blinkCycle;
  const blink = blinkAt < 3 ? 1 : blinkAt < 5 ? 0.6 : 0;
  const lid = Math.min(1, Math.max(f.lid + (isOcu ? 0.18 : 0), blink));
  const shrug = gesture === "shrug" ? -Math.max(0, Math.sin((gt / 18) * Math.PI)) * 18 : 0;
  const nod = (talking ? mouth * (isOcu ? 2 : 10) : 0) + shrug;
  const jitter = talking && f.shake ? (random(`${who}-x-${frame}`) - 0.5) * f.shake * 2 : 0;
  const jitterY = talking && f.shake ? (random(`${who}-y-${frame}`) - 0.5) * f.shake * 2 : 0;
  const tilt = f.tilt + (isOcu ? 4 : 0) + (talking && !isOcu ? Math.sin(frame / 6) * 2.5 : Math.sin(frame / 50) * 0.8);

  const eyeY = 300;
  const eyes = [246, 354];
  // eye-darts: when not looking at someone, the pupils jump to a new spot about once a second
  const dart = look === 0 ? (random(`${who}-dart-${Math.floor((frame + (isOcu ? 13 : 0)) / 28)}`) - 0.5) * 1.4 : 0;
  const lookX = (look + dart) * 8;
  const lookY = expression === "thinking" ? -9 : isOcu ? 2 : 0;
  const eyeR = isOcu ? { rx: 30, ry: 26 } : { rx: 34, ry: 36 };

  // Mouth: Uco gapes, Ocu barely moves his lips.
  const open = talking ? Math.max(0, mouth) * (isOcu ? 26 : 70) : 0;
  const w = (isOcu ? 58 : 80) + open * (isOcu ? 0.3 : 0.6);
  const my = 404;
  const curve = f.curve * 16;
  const lc = f.asym ? curve * -0.15 : curve;
  const rc = curve;
  const mouthPath =
    open > 3
      ? `M ${300 - w / 2} ${my - lc} Q 300 ${my + curve * 0.6 - 8} ${300 + w / 2} ${my - rc} Q 300 ${my + open * 1.6 + curve * 0.3} ${300 - w / 2} ${my - lc} Z`
      : null;
  const closedMouth = `M ${300 - w / 2} ${my - lc} Q 300 ${my + curve} ${300 + w / 2} ${my - rc}`;
  const angry = ["angry", "furious"].includes(expression);

  return (
    <svg viewBox="0 0 600 820" width="100%" height="100%" style={{ overflow: "visible" }}>
      <defs>
        {/* irregular, boiling ink lines */}
        <filter id={`${id}-ink`} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={boil % 7} />
          <feDisplacementMap in="SourceGraphic" scale={3.2} xChannelSelector="R" yChannelSelector="G" />
        </filter>
        {/* Ben-Day halftone */}
        <pattern id={`${id}-dots`} width={12} height={12} patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
          <circle cx={6} cy={6} r={2.6} fill={INK} />
        </pattern>
        {eyes.map((x, i) => (
          <clipPath id={`${id}-eye-${i}`} key={i}>
            <ellipse cx={x} cy={eyeY} rx={eyeR.rx} ry={eyeR.ry} />
          </clipPath>
        ))}
        <clipPath id={`${id}-mouth`}>{mouthPath && <path d={mouthPath} />}</clipPath>
      </defs>

      <g filter={`url(#${id}-ink)`}>
        {/* body (Ocu slumps lower) */}
        <g transform={`translate(${isOcu ? 0 : 0} ${breathe * 0.6 + (isOcu ? 18 : 0)})`}>
          {isOcu ? <OcuBody id={id} /> : <UcoBody id={id} />}
        </g>

        {/* head */}
        <g transform={`translate(${jitter} ${breathe + nod + jitterY + (isOcu ? 22 : 0)}) rotate(${tilt} 300 470)`}>
          <path d="M 262 410 L 338 410 L 342 540 L 258 540 Z" fill={c.skin} stroke={INK} strokeWidth={S} />
          <path d="M 262 450 Q 300 494 338 450 L 338 420 L 262 420 Z" fill={`url(#${id}-dots)`} opacity={0.5} />
          <Ear x={isOcu ? 156 : 152} c={c} flip={false} />
          <Ear x={isOcu ? 444 : 448} c={c} flip />
          {/* face: Uco angular jaw, Ocu long and soft */}
          <path
            d={
              isOcu
                ? "M 300 132 C 398 132 444 204 442 300 C 440 396 392 474 300 480 C 208 474 160 396 158 300 C 156 204 202 132 300 132 Z"
                : "M 300 124 C 404 124 452 196 450 290 C 448 370 420 430 372 462 L 300 486 L 228 462 C 180 430 152 370 150 290 C 148 196 196 124 300 124 Z"
            }
            fill={c.skin}
            stroke={INK}
            strokeWidth={S}
          />
          {/* halftone shading on the far cheek + jaw */}
          <path d="M 400 220 C 440 280 436 380 380 450 C 410 380 412 300 400 220 Z" fill={`url(#${id}-dots)`} opacity={0.45} />
          <path d="M 200 420 Q 300 500 400 420 Q 300 476 200 420 Z" fill={`url(#${id}-dots)`} opacity={0.45} />

          {f.blush > 0 && (
            <g opacity={f.blush}>
              <ellipse cx={204} cy={376} rx={30} ry={13} fill="#E5383B" opacity={0.5} />
              <ellipse cx={396} cy={376} rx={30} ry={13} fill="#E5383B" opacity={0.5} />
            </g>
          )}
          {/* Ocu's stubble */}
          {isOcu &&
            Array.from({ length: 26 }, (_, i) => (
              <circle key={i} cx={232 + random(`st${i}`) * 136} cy={432 + random(`sy${i}`) * 36} r={2.2} fill={INK} opacity={0.5} />
            ))}

          {/* eyes */}
          {eyes.map((x, i) => (
            <g key={i}>
              <ellipse cx={x} cy={eyeY} rx={eyeR.rx} ry={eyeR.ry} fill={COLORS.white} stroke={INK} strokeWidth={4} />
              <g clipPath={`url(#${id}-eye-${i})`}>
                <circle cx={x + lookX} cy={eyeY + lookY + 2} r={(isOcu ? 12 : 10) * f.pupil} fill={INK} />
                <circle cx={x + lookX + 3} cy={eyeY + lookY - 2} r={3 * f.pupil} fill={COLORS.white} />
                {/* frantic bloodshot lines */}
                {!isOcu && angry && (
                  <path d={`M ${x - 30} ${eyeY + 6} l 12 -2 M ${x + 30} ${eyeY + 8} l -12 -3`} stroke="#E5383B" strokeWidth={2.5} />
                )}
                <rect x={x - 36} y={eyeY - 38} width={72} height={76 * lid} fill={c.skin} />
                {lid > 0.05 && <line x1={x - 34} x2={x + 34} y1={eyeY - 38 + 76 * lid} y2={eyeY - 38 + 76 * lid} stroke={INK} strokeWidth={6} />}
              </g>
              {isOcu && <path d={`M ${x - 22} ${eyeY + 32} q 22 10 44 0`} stroke={c.shade} strokeWidth={5} fill="none" />}
            </g>
          ))}

          {/* brows */}
          {eyes.map((x, i) => {
            const rot = i === 0 ? -f.brow : f.brow;
            const thick = isOcu ? 11 : 16;
            const by = eyeY - (isOcu ? 62 : 72) + f.browY;
            return (
              <path
                key={i}
                d={`M ${x - 36} ${by + 4} Q ${x} ${by - thick} ${x + 36} ${by + 2} L ${x + 34} ${by + thick * 0.7} Q ${x} ${by - 2} ${x - 34} ${by + thick} Z`}
                fill={c.hair}
                transform={`rotate(${rot} ${x} ${by})`}
              />
            );
          })}

          {/* glasses: Uco oversized angular, Ocu massive circles */}
          <g fill="none" stroke={INK}>
            {isOcu ? (
              <g strokeWidth={8}>
                <circle cx={244} cy={eyeY} r={60} fill="rgba(248,249,250,0.12)" />
                <circle cx={356} cy={eyeY} r={60} fill="rgba(248,249,250,0.12)" />
                <path d={`M 302 ${eyeY - 6} Q 300 ${eyeY - 14} 298 ${eyeY - 6}`} />
                <line x1={184} y1={eyeY - 8} x2={156} y2={eyeY - 14} />
                <line x1={416} y1={eyeY - 8} x2={444} y2={eyeY - 14} />
              </g>
            ) : (
              <g strokeWidth={12} strokeLinejoin="miter">
                <path d={`M 178 ${eyeY - 52} L 296 ${eyeY - 46} L 292 ${eyeY + 40} L 186 ${eyeY + 46} Z`} fill="rgba(248,249,250,0.12)" />
                <path d={`M 422 ${eyeY - 52} L 304 ${eyeY - 46} L 308 ${eyeY + 40} L 414 ${eyeY + 46} Z`} fill="rgba(248,249,250,0.12)" />
                <line x1={296} y1={eyeY - 16} x2={304} y2={eyeY - 16} />
                <line x1={178} y1={eyeY - 40} x2={146} y2={eyeY - 34} />
                <line x1={422} y1={eyeY - 40} x2={454} y2={eyeY - 34} />
              </g>
            )}
          </g>
          <path d={isOcu ? `M 210 ${eyeY - 34} l 16 -12` : `M 196 ${eyeY - 32} l 24 -12`} stroke={COLORS.white} strokeWidth={6} strokeLinecap="round" opacity={0.85} />

          {/* nose */}
          <path d={isOcu ? "M 300 326 Q 320 356 296 366" : "M 304 320 Q 330 358 294 368"} fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />

          {/* mouth */}
          {mouthPath ? (
            <g>
              <path d={mouthPath} fill="#4A1414" />
              <g clipPath={`url(#${id}-mouth)`}>
                <ellipse cx={300} cy={my + open * 1.3 + curve * 0.3} rx={w * 0.34} ry={Math.min(open * 0.45, 24)} fill="#D9534F" />
                {open > 10 && <rect x={300 - w / 2} y={my - Math.max(lc, rc) - 12} width={w} height={16 + open * 0.12} fill={COLORS.white} stroke={INK} strokeWidth={2} />}
                {!isOcu && open > 30 && <rect x={300 - w * 0.4} y={my + open * 1.45} width={w * 0.8} height={14} fill={COLORS.white} stroke={INK} strokeWidth={2} />}
              </g>
              <path d={mouthPath} fill="none" stroke={INK} strokeWidth={6} strokeLinejoin="round" />
            </g>
          ) : (
            <path d={closedMouth} fill="none" stroke={INK} strokeWidth={7} strokeLinecap="round" />
          )}

          {isOcu ? <OcuHair c={c} frame={frame} /> : <UcoHair c={c} frame={frame} angry={f.shake > 3} />}

          {props && angry && !isOcu && <AngerVein frame={frame} />}
          {props && (angry || expression === "worried") && <SweatDrops frame={frame} side={isOcu ? 1 : -1} />}
        </g>

        {isOcu && drink && gesture !== "none" && (
          <Drink
            color={drink}
            frame={frame}
            breathe={breathe}
            sip={gesture === "sip" ? sipAmount(gt, glen) : gesture === "lift" ? liftAmount(gt, glen) : gesture === "sipHold" ? Math.min(1, gt / 9) : 0}
          />
        )}
        <Arms who={who} gesture={gesture} gt={gt} glen={glen} mouth={talking ? mouth : 0} frame={frame} shrug={shrug} />
      </g>
    </svg>
  );
}

function Ear({ x, c, flip }: { x: number; c: (typeof LOOK)["uco"]; flip: boolean }) {
  return (
    <g>
      <ellipse cx={x} cy={318} rx={28} ry={38} fill={c.skin} stroke={INK} strokeWidth={S} />
      <path d={`M ${x + (flip ? -8 : 8)} 298 q ${flip ? 12 : -12} 20 0 40`} stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />
    </g>
  );
}

function UcoHair({ c, frame, angry }: { c: (typeof LOOK)["uco"]; frame: number; angry: boolean }) {
  // wild, jagged spikes; they twitch when he is angry
  const n = 15;
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI * (1.0 + (1.0 * i) / n);
    const wob = angry ? Math.sin(frame / 1.5 + i * 2) * 7 : Math.sin(frame / 14 + i) * 2;
    const r = i % 2 ? 250 + wob + (i % 4 === 1 ? 20 : 0) : 172;
    pts.push(`${300 + r * Math.cos(a) * 1.04},${300 + r * Math.sin(a)}`);
  }
  return (
    <g strokeLinejoin="miter">
      <path
        d={`M 146 330 L ${pts.join(" L ")} L 454 330 L 436 250 L 404 268 L 392 214 L 352 246 L 334 196 L 300 240 L 270 194 L 248 246 L 210 212 L 196 268 L 164 250 Z`}
        fill={c.hair}
        stroke={INK}
        strokeWidth={S}
      />
      <path d="M 210 150 L 250 132 M 300 118 L 340 124" stroke={c.hairHi} strokeWidth={8} strokeLinecap="round" />
    </g>
  );
}

function OcuHair({ c, frame }: { c: (typeof LOOK)["ocu"]; frame: number }) {
  // messy, flat, relaxed: a mop that droops over the forehead, a few stray strands
  const sway = Math.sin(frame / 40) * 2;
  return (
    <g strokeLinejoin="round">
      <path
        d={`M 150 330 C 128 230 150 150 214 118 C 260 90 330 86 384 104 C 440 124 470 190 456 330
            C 446 290 436 262 420 246 L 414 ${282 + sway} L 388 236 L 368 ${270 + sway} L 344 228 L 318 ${262 + sway} L 292 226
            L 262 ${268 + sway} L 244 230 L 216 ${266 + sway} L 196 240 C 174 262 160 292 150 330 Z`}
        fill={c.hair}
        stroke={INK}
        strokeWidth={S}
      />
      <path d={`M 230 104 C 220 80 236 66 252 72 M 352 96 C 368 72 392 80 388 98`} stroke={INK} strokeWidth={6} fill="none" strokeLinecap="round" />
      <path d="M 210 150 C 260 124 330 120 400 142" stroke={c.hairHi} strokeWidth={8} fill="none" strokeLinecap="round" />
    </g>
  );
}

function UcoBody({ id }: { id: string }) {
  return (
    <g strokeLinejoin="round">
      {/* orange collared shirt, shoulders squared and forward */}
      <path d="M 60 1300 L 70 800 C 80 590 178 516 300 510 C 422 516 520 590 530 800 L 540 1300 Z" fill={COLORS.uco} stroke={INK} strokeWidth={S} />
      <path d="M 430 600 C 480 660 500 760 500 1300 L 540 1300 L 530 800 C 522 690 490 626 430 600 Z" fill={`url(#${id}-dots)`} opacity={0.5} />
      <path d="M 300 560 L 226 500 L 206 590 Z" fill={COLORS.ucoAmber} stroke={INK} strokeWidth={7} />
      <path d="M 300 560 L 374 500 L 394 590 Z" fill={COLORS.ucoAmber} stroke={INK} strokeWidth={7} />
      <path d="M 300 560 L 300 1300" stroke={INK} strokeWidth={6} />
      {[640, 740, 840].map((y) => (
        <circle key={y} cx={318} cy={y} r={8} fill={COLORS.white} stroke={INK} strokeWidth={4} />
      ))}
      <path d="M 120 760 L 200 700 L 210 760" stroke={COLORS.ucoDeep} strokeWidth={8} fill="none" />
    </g>
  );
}

function OcuBody({ id }: { id: string }) {
  return (
    <g strokeLinejoin="round">
      {/* grey tee, slouched round shoulders */}
      <path d="M 70 1300 L 76 860 C 70 660 170 556 300 546 C 430 556 530 660 524 860 L 530 1300 Z" fill="#5C6670" stroke={INK} strokeWidth={S} />
      <path d="M 236 552 Q 300 600 364 552" stroke={INK} strokeWidth={7} fill="none" />
      <path d="M 420 640 C 470 700 490 800 486 1300 L 530 1300 L 524 860 C 520 740 480 670 420 640 Z" fill={`url(#${id}-dots)`} opacity={0.5} />
      <path d="M 160 760 Q 190 820 186 900 M 300 640 Q 290 700 310 760" stroke="#47505A" strokeWidth={7} fill="none" />
    </g>
  );
}

function Drink({ color, frame, breathe, sip = 0 }: { color: string; frame: number; breathe: number; sip?: number }) {
  // clear plastic iced cup with straw, held loosely low on the left; `sip` (0..1) raises it to the mouth
  // raised, the straw tip lands at the mouth and the cup stays below the chin
  const y = 640 + breathe * 0.6 + Math.sin(frame / 45) * 3 - sip * 150;
  const x = 70 + sip * 100;
  return (
    <g transform={`translate(${x} ${y}) rotate(${-4 + sip * 18})`}>
      <path d="M 0 0 L 150 0 L 134 230 L 16 230 Z" fill="rgba(230,240,240,0.35)" stroke={INK} strokeWidth={7} />
      <path d="M 8 70 L 142 70 L 134 226 L 16 226 Z" fill={color} />
      <path d="M 8 70 L 142 70 L 138 120 L 12 120 Z" fill={`rgba(255,255,255,0.25)`} />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={20 + i * 40} y={80 + (i % 2) * 22} width={34} height={30} rx={6} fill="rgba(255,255,255,0.55)" stroke={INK} strokeWidth={3} transform={`rotate(${i * 12 - 10} ${36 + i * 40} ${94})`} />
      ))}
      <rect x={-8} y={-14} width={166} height={18} rx={6} fill="rgba(240,248,248,0.7)" stroke={INK} strokeWidth={6} />
      <path d="M 96 -14 L 120 -110" stroke="#2D6A4F" strokeWidth={12} strokeLinecap="round" />
      {/* hand wrapped around the cup */}
      <path d="M 120 120 C 170 100 196 130 190 170 C 186 200 150 214 120 206 Z" fill={LOOK.ocu.skin} stroke={INK} strokeWidth={7} />
      <path d="M 150 140 L 186 146 M 146 168 L 184 172" stroke={INK} strokeWidth={4} />
    </g>
  );
}

function AngerVein({ frame }: { frame: number }) {
  const s = 1 + Math.sin(frame / 2.5) * 0.15;
  return (
    <g transform={`translate(424 150) scale(${s})`} stroke="#E5383B" strokeWidth={9} strokeLinecap="round" fill="none">
      <path d="M -28 -8 Q -8 -8 -8 -28" />
      <path d="M 28 -8 Q 8 -8 8 -28" />
      <path d="M -28 8 Q -8 8 -8 28" />
      <path d="M 28 8 Q 8 8 8 28" />
    </g>
  );
}

function SweatDrops({ frame, side }: { frame: number; side: number }) {
  return (
    <g>
      {[0, 1, 2].map((i) => {
        const t = ((frame + i * 9) % 27) / 27;
        const x = 300 + side * (170 + t * 70 + i * 10);
        const y = 230 + i * 40 - t * 30;
        return <path key={i} d={`M ${x} ${y} q 10 18 0 26 q -10 -8 0 -26 Z`} fill="#8ECAE6" stroke={INK} strokeWidth={3.5} opacity={1 - t} />;
      })}
    </g>
  );
}

export type Gesture = "none" | "hold" | "point" | "fist" | "slap" | "receipt" | "shrug" | "chin" | "offer" | "wave" | "sip" | "rub" | "phone" | "cross" | "present" | "lift" | "sipHold";

/** 0..1 how far Ocu's cup is raised: up over 20% → 35% of the line, held, down by 75%. */
export function sipAmount(gt: number, glen: number) {
  const p = gt / Math.max(1, glen);
  const ease = (x: number) => x * x * (3 - 2 * x);
  if (p < 0.15) return 0;
  if (p < 0.35) return ease((p - 0.15) / 0.2);
  if (p < 0.6) return 1;
  if (p < 0.75) return 1 - ease((p - 0.6) / 0.15);
  return 0;
}

/** Ocu slowly lifting his cup to chest height over the line, linear and unbothered. */
export const liftAmount = (gt: number, glen: number) => Math.min(0.55, (gt / Math.max(1, glen)) * 0.9);

/** When Uco's slap lands (frame within the line): the chart flies off at the same moment. */
export const slapAt = (glen: number) => Math.floor(glen * 0.45);

const SLEEVE = { uco: COLORS.uco, ocu: "#5C6670" };

function Arm({ x, y, angle, len, sleeve, skin, hand }: { x: number; y: number; angle: number; len: number; sleeve: string; skin: string; hand: "point" | "fist" | "open" }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <line x1={0} y1={0} x2={len} y2={0} stroke={INK} strokeWidth={76} strokeLinecap="round" />
      <line x1={0} y1={0} x2={len} y2={0} stroke={sleeve} strokeWidth={60} strokeLinecap="round" />
      <line x1={len - 30} y1={-30} x2={len - 30} y2={30} stroke={INK} strokeWidth={5} />
      <g transform={`translate(${len + 18} 0)`}>
        {hand === "point" && <rect x={8} y={-10} width={70} height={22} rx={11} fill={skin} stroke={INK} strokeWidth={6} />}
        {hand === "open" &&
          [-24, -8, 8, 24].map((dy) => <rect key={dy} x={10} y={dy - 7} width={52} height={16} rx={8} fill={skin} stroke={INK} strokeWidth={5} />)}
        <circle cx={0} cy={0} r={36} fill={skin} stroke={INK} strokeWidth={7} />
        {hand === "fist" && <path d="M -6 -22 q 20 0 20 10 M -6 -2 q 20 0 20 10 M -6 18 q 18 0 18 8" stroke={INK} strokeWidth={4} fill="none" />}
        {hand !== "fist" && <path d="M -10 -34 q -20 -10 -24 8" stroke={INK} strokeWidth={6} fill={skin} />}
      </g>
    </g>
  );
}

function Arms({ who, gesture, gt, glen, mouth, frame, shrug }: { who: Speaker; gesture: Gesture; gt: number; glen: number; mouth: number; frame: number; shrug: number }) {
  const c = LOOK[who];
  const sleeve = SLEEVE[who];
  const R = { x: 452, y: 640 + shrug * 0.5 }; // the character's left shoulder, on the viewer's right
  const L = { x: 148, y: 640 + shrug * 0.5 };
  const arm = (p: { x: number; y: number }, angle: number, len: number, hand: "point" | "fist" | "open") => (
    <Arm x={p.x} y={p.y} angle={angle} len={len} sleeve={sleeve} skin={c.skin} hand={hand} />
  );
  switch (gesture) {
    case "point": // jabbing across at the other guy
      return arm(R, -32 + Math.sin(frame / 4) * 3, 250 + Math.max(0, Math.sin(frame / 3.2)) * 26 + mouth * 10, "point");
    case "fist": // shaking fist raised
      return arm(R, -104 + Math.sin(frame * 1.9) * 7, 230, "fist");
    case "slap": {
      // wind up, then one fast sweep at slapAt, follow through
      const hit = slapAt(glen);
      let a = -20;
      if (gt < hit - 8) a = interpolateClamp(gt, 0, hit - 8, 10, -120);
      else if (gt < hit) a = -120;
      else a = interpolateClamp(gt, hit, hit + 4, -120, 25);
      return arm(R, a, 250, "open");
    }
    case "receipt": {
      // both hands hold the top of a receipt that unrolls to the floor
      const len = interpolateClamp(gt, 0, glen * 0.4, 40, 620);
      const zig = Array.from({ length: 12 }, (_, i) => `${i % 2 ? 208 : 222},${780 + (len / 12) * (i + 1)}`).join(" ");
      return (
        <g>
          <path d={`M 200 760 L 400 760 L 400 ${780 + len} L ${zig.split(" ").reverse().join(" L ")} Z`} fill={COLORS.white} stroke={INK} strokeWidth={6} />
          {Array.from({ length: Math.floor(len / 34) }, (_, i) => (
            <g key={i}>
              <line x1={226} x2={330} y1={800 + i * 34} y2={800 + i * 34} stroke={INK} strokeWidth={5} />
              <line x1={346} x2={384} y1={800 + i * 34} y2={800 + i * 34} stroke={i % 3 === 1 ? "#E5383B" : INK} strokeWidth={5} />
            </g>
          ))}
          {arm(L, 64, 150, "fist")}
          {arm(R, 116, 150, "fist")}
        </g>
      );
    }
    case "shrug": // palms up at both sides
      return (
        <g>
          {arm(L, 168 - shrug * 0.6, 170, "open")}
          {arm(R, 12 + shrug * 0.6, 170, "open")}
        </g>
      );
    case "chin": // hand to chin, thinking
      return arm(R, -126, 196, "fist");
    case "offer": {
      // slides something across (a fresh cup) toward the other side
      const reach = interpolateClamp(gt, 0, 14, 120, 250);
      return (
        <g>
          {arm(R, -6, reach, "open")}
          <g transform={`translate(${R.x + reach + 30} ${R.y - 150}) scale(0.9)`}>
            <path d="M 0 0 L 110 0 L 98 160 L 12 160 Z" fill="rgba(230,240,240,0.4)" stroke={INK} strokeWidth={6} />
            <path d="M 5 50 L 105 50 L 98 157 L 12 157 Z" fill="#8DB255" />
            <path d="M 70 0 L 86 -70" stroke="#2D6A4F" strokeWidth={10} strokeLinecap="round" />
          </g>
        </g>
      );
    }
    case "wave": // talking with his hand, timed to the voice
      return arm(R, -40 - mouth * 30 + Math.sin(frame / 5) * 8, 220, "open");
    case "phone": {
      // scrolling a glowing phone furiously at chest height
      const tap = Math.sin(frame * 2.6) > 0.3 ? 6 : 0;
      return (
        <g>
          <g transform="translate(300 700) rotate(-8)">
            <rect x={-70} y={-120} width={140} height={240} rx={22} fill={INK} />
            <rect x={-58} y={-104} width={116} height={204} rx={10} fill="#BFF4FF" />
            <rect x={-58} y={-104} width={116} height={204} rx={10} fill="#FFFFFF" opacity={0.35 + 0.25 * Math.sin(frame / 3)} />
            {[0, 1, 2, 3].map((k) => {
              const y = -96 + ((k * 52 + frame * 9) % 208);
              return <rect key={k} x={-48} y={y} width={96} height={38} rx={6} fill={k % 2 ? COLORS.uco : COLORS.ocu} opacity={0.8} />;
            })}
          </g>
          {arm(L, 52, 140, "fist")}
          <Arm x={R.x} y={R.y} angle={150 - tap * 0.4} len={150 + tap} sleeve={sleeve} skin={c.skin} hand="point" />
          <circle cx={300} cy={640} r={180} fill="#BFF4FF" opacity={0.12 + 0.06 * Math.sin(frame / 2)} />
        </g>
      );
    }
    case "cross": // arms folded, stubborn
      return (
        <g strokeLinejoin="round">
          <path d="M 110 770 C 170 700 360 700 490 760 L 494 850 C 360 800 190 800 114 860 Z" fill={sleeve} stroke={INK} strokeWidth={8} />
          <path d="M 500 790 C 440 740 260 744 120 800 L 114 890 C 250 836 420 836 496 890 Z" fill={sleeve} stroke={INK} strokeWidth={8} />
          <path d="M 120 800 l 0 0" />
          <circle cx={470} cy={784} r={30} fill={c.skin} stroke={INK} strokeWidth={6} />
          <circle cx={132} cy={846} r={30} fill={c.skin} stroke={INK} strokeWidth={6} />
        </g>
      );
    case "present": // calm open palm toward the evidence
      return arm(R, -24 + Math.sin(frame / 30) * 3, 230, "open");
    case "rub": {
      // rubbing his eye under the glasses
      const wob = Math.sin(frame / 3) * 6;
      return arm({ x: R.x + 10, y: R.y }, -97 + wob * 0.3, 300 + wob, "open"); // up the side of the face to the outer eye
    }
    default:
      return null;
  }
}

function interpolateClamp(v: number, a: number, b: number, from: number, to: number) {
  const t = Math.min(1, Math.max(0, (v - a) / Math.max(1e-6, b - a)));
  return from + (to - from) * t;
}
