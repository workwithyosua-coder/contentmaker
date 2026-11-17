import React from "react";
import { random } from "remotion";
import { COLORS, type Expression, type Speaker } from "./types";

// Uco & Ocu as SVG puppets, drawn after the reference art (the "UCO & OCU" badge the owner shared):
// Uco: ginger messy hair, black rectangular glasses, mustard sweater over a pale yellow collar, loud.
// Ocu: slate quiff, round glasses, half-lidded eyes and a smirk, dark turtleneck + grey-blue blazer, arms crossed.
// Everything is drawn in a 600 x 820 box (head + chest); the body continues below for tall frames.

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

const FACES: Record<string, Face> = {
  deadpan: { brow: 0, browY: 4, lid: 0.45, curve: 0.12, pupil: 0.9, shake: 0, blush: 0, tilt: -2, asym: true },
  calm: { brow: 3, browY: 0, lid: 0.35, curve: 0.25, pupil: 1, shake: 0, blush: 0, tilt: -3, asym: true },
  worried: { brow: 16, browY: -6, lid: 0.1, curve: -0.55, pupil: 0.8, shake: 1, blush: 0, tilt: 4 },
  angry: { brow: -22, browY: 6, lid: 0.05, curve: -0.5, pupil: 0.7, shake: 3, blush: 0.5, tilt: 0 },
  furious: { brow: -30, browY: 10, lid: 0, curve: -0.7, pupil: 0.55, shake: 7, blush: 1, tilt: 0 },
  excited: { brow: 10, browY: -14, lid: 0, curve: 0.85, pupil: 1.1, shake: 2, blush: 0.25, tilt: -4 },
  thinking: { brow: 8, browY: -2, lid: 0.35, curve: -0.25, pupil: 0.9, shake: 0, blush: 0, tilt: 6 },
  smug: { brow: -6, browY: 2, lid: 0.45, curve: 0.45, pupil: 0.9, shake: 0, blush: 0.15, tilt: -5, asym: true },
};
export const faceFor = (e: Expression) => FACES[e] ?? FACES.calm;

const LOOK = {
  uco: { skin: "#F4BE95", shade: "#D9946A", hair: "#D8662A", hairDark: "#A84517", hairLight: "#F08A45", brow: "#A84517" },
  ocu: { skin: "#9DBDC2", shade: "#7A9CA3", hair: "#3B5560", hairDark: "#263B44", hairLight: "#557280", brow: "#263B44" },
};

const INK = COLORS.ink;
const S = 7; // outline width

export function Character({
  who,
  expression,
  mouth,
  frame,
  talking,
  look = 0,
  props = true,
}: {
  who: Speaker;
  expression: Expression;
  /** 0..1 mouth openness for this frame. */
  mouth: number;
  frame: number;
  talking: boolean;
  /** Where the pupils point: -1 left .. 1 right. */
  look?: number;
  /** Draw the expression extras (anger mark, sweat, "..."). */
  props?: boolean;
}) {
  const f = faceFor(expression);
  const c = LOOK[who];
  const isOcu = who === "ocu";

  // Idle life: breathing, blinks, a nod with the voice, jitter when angry.
  const breathe = Math.sin(frame / (isOcu ? 24 : 16)) * (isOcu ? 3 : 5);
  const blinkCycle = isOcu ? 113 : 89;
  const blinkAt = (frame + (isOcu ? 40 : 0)) % blinkCycle;
  const blink = blinkAt < 3 ? 1 : blinkAt < 5 ? 0.6 : 0;
  const lid = Math.min(1, Math.max(f.lid + (isOcu ? 0.15 : 0), blink));
  const nod = talking ? mouth * (isOcu ? 3 : 8) : 0;
  const jitter = talking && f.shake ? (random(`${who}-x-${frame}`) - 0.5) * f.shake * 2 : 0;
  const jitterY = talking && f.shake ? (random(`${who}-y-${frame}`) - 0.5) * f.shake * 2 : 0;
  const tilt = f.tilt + (talking ? Math.sin(frame / 7) * (isOcu ? 0.8 : 2.4) : Math.sin(frame / 40) * 1);

  const eyeY = 300;
  const eyes = [248, 352];
  const lookX = look * 8;
  const lookY = expression === "thinking" ? -8 : 0;
  const eyeR = isOcu ? { rx: 23, ry: 22 } : { rx: 30, ry: 32 };

  // Mouth: Uco's opens huge (teeth + tongue), Ocu barely parts his lips.
  const open = talking ? Math.max(0, mouth) * (isOcu ? 30 : 62) : 0;
  const w = (isOcu ? 58 : 74) + open * (isOcu ? 0.3 : 0.7);
  const my = 400;
  const curve = f.curve * 16;
  const lc = f.asym ? curve * -0.1 : curve; // left corner
  const rc = curve;
  const mouthPath =
    open > 3
      ? `M ${300 - w / 2} ${my - lc} Q 300 ${my + curve * 0.6 - 6} ${300 + w / 2} ${my - rc} Q 300 ${my + open * 1.6 + curve * 0.3} ${300 - w / 2} ${my - lc} Z`
      : null;
  const closedMouth = `M ${300 - w / 2} ${my - lc} Q 300 ${my + curve} ${300 + w / 2} ${my - rc}`;
  const angry = ["angry", "furious"].includes(expression);

  return (
    <svg viewBox="0 0 600 820" width="100%" height="100%" style={{ overflow: "visible" }}>
      <defs>
        {eyes.map((x, i) => (
          <clipPath id={`${who}-eye-${i}`} key={i}>
            <ellipse cx={x} cy={eyeY} rx={eyeR.rx} ry={eyeR.ry} />
          </clipPath>
        ))}
        <clipPath id={`${who}-mouth`}>{mouthPath && <path d={mouthPath} />}</clipPath>
      </defs>

      {/* body */}
      <g transform={`translate(0 ${breathe * 0.6})`}>{isOcu ? <OcuBody /> : <UcoBody />}</g>

      {/* head */}
      <g transform={`translate(${jitter} ${breathe + nod + jitterY}) rotate(${tilt} 300 470)`}>
        <rect x={262} y={420} width={76} height={110} fill={c.skin} stroke={INK} strokeWidth={S} />
        <path d="M 264 470 Q 300 500 336 470 L 336 440 L 264 440 Z" fill={c.shade} opacity={0.6} />
        {/* ears (Uco's stick out) */}
        <Ear x={isOcu ? 158 : 150} c={c} big={!isOcu} flip={false} />
        <Ear x={isOcu ? 442 : 450} c={c} big={!isOcu} flip />
        {/* long face, narrow chin */}
        <path
          d="M 300 128 C 400 128 446 200 444 300 C 442 392 390 470 300 476 C 210 470 158 392 156 300 C 154 200 200 128 300 128 Z"
          fill={c.skin}
          stroke={INK}
          strokeWidth={S}
        />
        <path d="M 190 390 Q 300 520 410 390 Q 300 468 190 390 Z" fill={c.shade} opacity={0.35} />

        {/* cheeks */}
        {f.blush > 0 && (
          <g opacity={f.blush}>
            <ellipse cx={208} cy={372} rx={28} ry={13} fill="#FF4D4D" opacity={0.45} />
            <ellipse cx={392} cy={372} rx={28} ry={13} fill="#FF4D4D" opacity={0.45} />
          </g>
        )}
        {/* angry forehead creases */}
        {angry && !isOcu && <path d="M 262 222 q 38 -12 76 0 M 270 240 q 30 -8 60 0" stroke={c.shade} strokeWidth={5} fill="none" strokeLinecap="round" />}

        {/* eyes */}
        {eyes.map((x, i) => (
          <g key={i}>
            <ellipse cx={x} cy={eyeY} rx={eyeR.rx} ry={eyeR.ry} fill="#fff" stroke={INK} strokeWidth={4} />
            <g clipPath={`url(#${who}-eye-${i})`}>
              <circle cx={x + lookX} cy={eyeY + lookY + 2} r={(isOcu ? 11 : 12) * f.pupil} fill={isOcu ? INK : "#3B2A1A"} />
              <circle cx={x + lookX + 4} cy={eyeY + lookY - 3} r={3.5 * f.pupil} fill="#fff" />
              <rect x={x - 34} y={eyeY - 36} width={68} height={72 * lid} fill={c.skin} />
              {lid > 0.05 && <line x1={x - 32} x2={x + 32} y1={eyeY - 36 + 72 * lid} y2={eyeY - 36 + 72 * lid} stroke={INK} strokeWidth={5} />}
            </g>
            {/* bags under Ocu's eyes */}
            {isOcu && <path d={`M ${x - 18} ${eyeY + 30} q 18 8 36 0`} stroke={c.shade} strokeWidth={4} fill="none" />}
          </g>
        ))}

        {/* brows */}
        {eyes.map((x, i) => {
          const rot = i === 0 ? -f.brow : f.brow;
          const thick = isOcu ? 10 : 14;
          return (
            <rect
              key={i}
              x={x - 34}
              y={eyeY - 66 + f.browY - thick / 2}
              width={68}
              height={thick}
              rx={thick / 2}
              fill={c.brow}
              stroke={INK}
              strokeWidth={2}
              transform={`rotate(${rot} ${x} ${eyeY - 66 + f.browY})`}
            />
          );
        })}

        {/* glasses: Uco black rectangles, Ocu thin round frames */}
        <g fill="none" stroke={INK}>
          {isOcu ? (
            <g strokeWidth={6}>
              <circle cx={248} cy={eyeY} r={46} fill="rgba(255,255,255,0.14)" />
              <circle cx={352} cy={eyeY} r={46} fill="rgba(255,255,255,0.14)" />
              <path d={`M 294 ${eyeY - 4} Q 300 ${eyeY - 12} 306 ${eyeY - 4}`} />
              <line x1={202} y1={eyeY - 8} x2={160} y2={eyeY - 16} />
              <line x1={398} y1={eyeY - 8} x2={440} y2={eyeY - 16} />
            </g>
          ) : (
            <g strokeWidth={11}>
              <rect x={190} y={eyeY - 42} width={108} height={82} rx={12} fill="rgba(255,255,255,0.12)" />
              <rect x={302} y={eyeY - 42} width={108} height={82} rx={12} fill="rgba(255,255,255,0.12)" />
              <line x1={298} y1={eyeY - 10} x2={302} y2={eyeY - 10} />
              <line x1={190} y1={eyeY - 20} x2={150} y2={eyeY - 26} />
              <line x1={410} y1={eyeY - 20} x2={450} y2={eyeY - 26} />
            </g>
          )}
        </g>
        <path d={isOcu ? `M 224 ${eyeY - 30} l 14 -8` : `M 206 ${eyeY - 26} l 20 -10`} stroke="#fff" strokeWidth={5} strokeLinecap="round" opacity={0.85} />

        {/* nose */}
        <path d={isOcu ? "M 300 322 Q 318 352 298 362" : "M 302 318 Q 326 356 296 366"} fill="none" stroke={c.shade} strokeWidth={6} strokeLinecap="round" />

        {/* mouth */}
        {mouthPath ? (
          <g>
            <path d={mouthPath} fill="#5B1A1A" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
            <g clipPath={`url(#${who}-mouth)`}>
              <ellipse cx={300} cy={my + open * 1.3 + curve * 0.3} rx={w * 0.34} ry={Math.min(open * 0.45, 22)} fill="#E8706A" />
              {open > 10 && <rect x={300 - w / 2} y={my - Math.max(lc, rc) - 10} width={w} height={14 + open * 0.12} fill="#fff" stroke={INK} strokeWidth={2} />}
              {!isOcu && open > 30 && <rect x={300 - w * 0.4} y={my + open * 1.45} width={w * 0.8} height={14} fill="#fff" stroke={INK} strokeWidth={2} />}
            </g>
            <path d={mouthPath} fill="none" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
          </g>
        ) : (
          <path d={closedMouth} fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round" />
        )}

        {/* hair on top */}
        {isOcu ? <OcuHair c={c} /> : <UcoHair c={c} frame={frame} angry={f.shake > 2} />}

        {/* expression extras */}
        {props && angry && !isOcu && <AngerMark frame={frame} red={expression === "furious"} />}
        {props && angry && !isOcu && talking && <Spit frame={frame} />}
        {props && expression === "worried" && <Sweat frame={frame} />}
      </g>
      {/* arms in front */}
      <g transform={`translate(0 ${breathe * 0.6})`}>{isOcu ? <OcuArms /> : null}</g>
    </svg>
  );
}

function Ear({ x, c, big, flip }: { x: number; c: (typeof LOOK)["uco"]; big: boolean; flip: boolean }) {
  const rx = big ? 34 : 26;
  const ry = big ? 46 : 34;
  return (
    <g>
      <ellipse cx={x} cy={318} rx={rx} ry={ry} fill={c.skin} stroke={INK} strokeWidth={S} />
      <path d={`M ${x + (flip ? -8 : 8)} 296 q ${flip ? 14 : -14} 22 0 44`} stroke={c.shade} strokeWidth={6} fill="none" strokeLinecap="round" />
    </g>
  );
}

function UcoHair({ c, frame, angry }: { c: (typeof LOOK)["uco"]; frame: number; angry: boolean }) {
  // messy ginger flicks; they twitch when he is angry
  const t = angry ? Math.sin(frame / 2) * 5 : Math.sin(frame / 18) * 2;
  return (
    <g strokeLinejoin="round">
      <path
        d={`M 150 300 C 136 220 150 170 186 140 L 160 ${92 + t} L 222 118 L 214 ${60 - t} L 270 104 L 290 ${44 + t} L 322 100
            L 372 ${58 - t} L 380 112 L 440 ${92 + t} L 424 150 C 456 180 462 240 450 300
            C 440 250 420 222 396 210 L 404 254 L 360 214 L 344 250 L 316 206 L 282 244 L 270 210 L 232 250 L 228 212 C 196 226 168 252 150 300 Z`}
        fill={c.hair}
        stroke={INK}
        strokeWidth={S}
      />
      <path d={`M 214 ${70 - t} L 236 128 M 290 ${54 + t} L 296 120 M 372 ${68 - t} L 360 124`} stroke={c.hairDark} strokeWidth={6} strokeLinecap="round" />
      <path d="M 200 160 Q 250 132 300 138" stroke={c.hairLight} strokeWidth={9} fill="none" strokeLinecap="round" />
      {/* forelock falling over the brow */}
      <path d="M 300 206 C 296 236 280 252 262 262 C 286 246 292 226 290 208 Z" fill={c.hair} stroke={INK} strokeWidth={5} />
    </g>
  );
}

function OcuHair({ c }: { c: (typeof LOOK)["ocu"] }) {
  // neat quiff swept up and back, forehead clear
  return (
    <g strokeLinejoin="round">
      <path
        d="M 156 300 C 140 200 170 120 236 96 C 260 60 330 42 390 64 C 450 86 470 150 446 210 C 452 240 450 270 444 300
           C 432 250 412 214 380 196 C 340 186 300 200 266 190 C 226 196 186 230 156 300 Z"
        fill={c.hair}
        stroke={INK}
        strokeWidth={S}
      />
      <path d="M 244 104 C 290 76 360 70 420 104 M 236 140 C 290 110 360 106 430 140" stroke={c.hairLight} strokeWidth={7} fill="none" strokeLinecap="round" />
      <path d="M 266 190 C 300 176 350 172 392 190" stroke={c.hairDark} strokeWidth={6} fill="none" strokeLinecap="round" />
      {/* sideburns */}
      <path d="M 160 300 L 172 336 L 178 290 Z M 440 300 L 428 336 L 422 290 Z" fill={c.hair} stroke={INK} strokeWidth={4} />
    </g>
  );
}

function UcoBody() {
  return (
    <g strokeLinejoin="round">
      {/* mustard sweater */}
      <path d="M 70 1300 L 78 820 C 86 590 180 520 300 514 C 420 520 514 590 522 820 L 530 1300 Z" fill={COLORS.ucoSweater} stroke={INK} strokeWidth={S} />
      <path d="M 150 700 Q 170 640 196 610 M 450 700 Q 430 640 404 610" stroke={COLORS.ucoSweaterDark} strokeWidth={7} fill="none" />
      {/* crew neck + pale yellow shirt collar */}
      <path d="M 218 528 Q 300 600 382 528 L 368 516 Q 300 572 232 516 Z" fill={COLORS.ucoSweaterDark} stroke={INK} strokeWidth={5} />
      <path d="M 300 560 L 236 504 L 220 566 Z" fill={COLORS.ucoShirt} stroke={INK} strokeWidth={6} />
      <path d="M 300 560 L 364 504 L 380 566 Z" fill={COLORS.ucoShirt} stroke={INK} strokeWidth={6} />
      {/* rib at the hem area */}
      <path d="M 300 600 L 300 1300" stroke={COLORS.ucoSweaterDark} strokeWidth={4} opacity={0.5} />
    </g>
  );
}

function OcuBody() {
  return (
    <g strokeLinejoin="round">
      {/* grey-blue blazer */}
      <path d="M 66 1300 L 74 820 C 82 596 180 524 300 518 C 420 524 518 596 526 820 L 534 1300 Z" fill={COLORS.ocuBlazer} stroke={INK} strokeWidth={S} />
      {/* turtleneck showing in the V */}
      <path d="M 220 540 L 300 900 L 380 540 Q 300 520 220 540 Z" fill={COLORS.ocuTurtle} stroke={INK} strokeWidth={6} />
      <rect x={236} y={448} width={128} height={100} rx={28} fill={COLORS.ocuTurtle} stroke={INK} strokeWidth={S} />
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i} x1={256 + i * 22} y1={460} x2={256 + i * 22} y2={538} stroke="#22383D" strokeWidth={5} />
      ))}
      {/* lapels */}
      <path d="M 220 540 L 300 900 L 250 700 L 190 640 L 214 600 L 180 570 Z" fill={COLORS.ocuBlazerLight} stroke={INK} strokeWidth={6} />
      <path d="M 380 540 L 300 900 L 350 700 L 410 640 L 386 600 L 420 570 Z" fill={COLORS.ocuBlazerLight} stroke={INK} strokeWidth={6} />
    </g>
  );
}

function OcuArms() {
  const c = LOOK.ocu;
  return (
    <g strokeLinejoin="round">
      {/* crossed forearms */}
      <path d="M 92 760 C 150 700 330 700 470 760 L 474 850 C 340 800 170 800 96 860 Z" fill={COLORS.ocuBlazer} stroke={INK} strokeWidth={S} />
      <path d="M 508 790 C 450 740 270 744 130 800 L 124 890 C 260 836 430 836 504 890 Z" fill={COLORS.ocuBlazerLight} stroke={INK} strokeWidth={S} />
      {/* hands tucked */}
      <path d="M 420 760 q 40 -30 70 0 q 10 30 -20 40 q -30 0 -50 -40 Z" fill={c.skin} stroke={INK} strokeWidth={6} />
      <path d="M 170 820 q -40 -24 -66 6 q -6 30 24 36 q 26 -4 42 -42 Z" fill={c.skin} stroke={INK} strokeWidth={6} />
    </g>
  );
}

function AngerMark({ frame, red }: { frame: number; red: boolean }) {
  const s = 1 + Math.sin(frame / 3) * 0.12;
  return (
    <g transform={`translate(430 120) scale(${s})`} stroke={red ? "#E23B3B" : INK} strokeWidth={8} strokeLinecap="round" fill="none">
      <path d="M -26 -8 Q -8 -8 -8 -26" />
      <path d="M 26 -8 Q 8 -8 8 -26" />
      <path d="M -26 8 Q -8 8 -8 26" />
      <path d="M 26 8 Q 8 8 8 26" />
    </g>
  );
}

function Spit({ frame }: { frame: number }) {
  return (
    <g>
      {[0, 1, 2].map((i) => {
        const t = ((frame + i * 7) % 20) / 20;
        return (
          <path
            key={i}
            d={`M ${200 - t * 120 - i * 10} ${400 - i * 30 - t * 40} q 8 14 0 20 q -8 -6 0 -20 Z`}
            fill="#8FD3F4"
            stroke={INK}
            strokeWidth={3}
            opacity={1 - t}
          />
        );
      })}
    </g>
  );
}

function Sweat({ frame }: { frame: number }) {
  const y = (frame % 45) * 1.2;
  return <path d={`M 452 ${250 + y} q 14 26 0 34 q -14 -8 0 -34 Z`} fill="#9BE7FF" stroke={INK} strokeWidth={4} opacity={1 - (frame % 45) / 60} />;
}
