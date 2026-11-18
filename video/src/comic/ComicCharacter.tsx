import React from "react";
import { random } from "remotion";
import { C, INK_PX } from "./theme";

// Uco & Ocu drawn after the UCO & OCU badge, for the Comic style (video/styles/comic.md §4).
// Flat cel colours, ink outlines that stay INK_PX on screen at any scale. Drawn in a 600 x 820 box (head + chest).

type Who = "uco" | "ocu";
export type ComicGesture = "talk" | "rant" | "crossed" | "lift" | "chin" | "none";

type Face = { brow: number; browY: number; lid: number; curve: number; pupil: number; shake: number };
const FACES: Record<string, Face> = {
  neutral: { brow: 0, browY: 0, lid: 0.15, curve: 0.1, pupil: 1, shake: 0 },
  calm: { brow: 2, browY: 0, lid: 0.45, curve: 0.25, pupil: 0.9, shake: 0 },
  deadpan: { brow: 0, browY: 4, lid: 0.55, curve: 0.15, pupil: 0.85, shake: 0 },
  smug: { brow: -6, browY: 2, lid: 0.5, curve: 0.4, pupil: 0.85, shake: 0 },
  thinking: { brow: 8, browY: -2, lid: 0.4, curve: -0.2, pupil: 0.85, shake: 0 },
  worried: { brow: 16, browY: -6, lid: 0.15, curve: -0.5, pupil: 0.75, shake: 1 },
  angry: { brow: -22, browY: 8, lid: 0, curve: -0.5, pupil: 0.6, shake: 3 },
  furious: { brow: -30, browY: 12, lid: 0, curve: -0.7, pupil: 0.5, shake: 6 },
  excited: { brow: 12, browY: -12, lid: 0, curve: 0.8, pupil: 1, shake: 2 },
  shocked: { brow: 18, browY: -16, lid: 0, curve: -0.2, pupil: 0.55, shake: 2 },
  laughing: { brow: 10, browY: -8, lid: 0.3, curve: 0.9, pupil: 0.9, shake: 2 },
};

const ink = { stroke: C.ink, strokeWidth: INK_PX, vectorEffect: "non-scaling-stroke" as const, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

export function ComicCharacter({
  who,
  expression,
  mouth,
  frame,
  talking,
  look = 0,
  gesture = "none",
  gt = 0,
  glen = 90,
  still = false,
}: {
  who: Who;
  expression: string;
  /** 0..1 mouth openness this frame */
  mouth: number;
  frame: number;
  talking: boolean;
  /** pupils: -1 left .. 1 right */
  look?: number;
  gesture?: ComicGesture;
  gt?: number;
  glen?: number;
  /** reduced motion: no jitter or bobbing */
  still?: boolean;
}) {
  const f = FACES[expression] ?? FACES.neutral;
  const ocu = who === "ocu";
  const skin = ocu ? C.ocuSkin : C.ucoSkin;
  const breathe = still ? 0 : Math.sin(frame / (ocu ? 32 : 14)) * (ocu ? 2 : 4);
  const blinkAt = (frame + (ocu ? 50 : 0)) % (ocu ? 127 : 89);
  const lid = Math.min(1, Math.max(f.lid + (ocu ? 0.15 : 0), blinkAt < 3 ? 1 : 0));
  const jitter = still || !talking || !f.shake ? 0 : (random(`${who}${frame}`) - 0.5) * f.shake * 2;
  const nod = talking && !still ? mouth * (ocu ? 2 : 9) : 0;
  const open = talking ? mouth * (ocu ? 22 : 66) : 0;
  const lookX = look * 7;

  // mouth: Uco's opens wide with teeth; Ocu's barely parts and otherwise holds a flat smirk
  const my = 405;
  const w = (ocu ? 56 : 82) + open * 0.5;
  const c = f.curve * 14;
  const left = ocu ? c * -0.2 : c; // Ocu's smirk lifts one corner
  const mouthPath =
    open > 3
      ? `M ${300 - w / 2} ${my - left} Q 300 ${my + c * 0.5 - 6} ${300 + w / 2} ${my - c} Q 300 ${my + open * 1.5} ${300 - w / 2} ${my - left} Z`
      : `M ${300 - w / 2} ${my - left} Q 300 ${my + c} ${300 + w / 2} ${my - c}`;

  return (
    <svg viewBox="0 0 600 820" width="100%" height="100%" style={{ overflow: "visible" }}>
      <g transform={`translate(0 ${breathe * 0.5})`}>{ocu ? <OcuBody /> : <UcoBody />}</g>
      <g transform={`translate(${jitter} ${breathe + nod}) rotate(${ocu ? 2 : -2} 300 470)`}>
        {/* neck + ears */}
        <rect x={262} y={410} width={76} height={120} fill={skin} {...ink} />
        <ellipse cx={ocu ? 158 : 148} cy={315} rx={ocu ? 24 : 34} ry={ocu ? 34 : 44} fill={skin} {...ink} />
        <ellipse cx={ocu ? 442 : 452} cy={315} rx={ocu ? 24 : 34} ry={ocu ? 34 : 44} fill={skin} {...ink} />
        {/* face: Uco long and lanky, Ocu long with a firm jaw */}
        <path
          d={
            ocu
              ? "M 300 128 C 396 128 440 196 440 292 C 440 380 404 456 352 478 L 300 486 L 248 478 C 196 456 160 380 160 292 C 160 196 204 128 300 128 Z"
              : "M 300 126 C 400 126 446 196 444 292 C 442 388 392 474 300 482 C 208 474 158 388 156 292 C 154 196 200 126 300 126 Z"
          }
          fill={skin}
          {...ink}
        />
        {/* eyes */}
        {[248, 352].map((x) => (
          <g key={x}>
            <ellipse cx={x} cy={300} rx={ocu ? 24 : 30} ry={ocu ? 20 : 30} fill={C.paper} {...ink} />
            <circle cx={x + lookX} cy={302} r={(ocu ? 9 : 11) * f.pupil} fill={ocu ? C.ink : "#5A3A1E"} />
            {lid > 0.02 && (
              <path d={`M ${x - (ocu ? 25 : 31)} 300 A ${ocu ? 25 : 31} ${(ocu ? 21 : 31) * 1} 0 0 1 ${x + (ocu ? 25 : 31)} 300 L ${x + (ocu ? 25 : 31)} ${300 - (ocu ? 21 : 31) + lid * (ocu ? 42 : 62)} L ${x - (ocu ? 25 : 31)} ${300 - (ocu ? 21 : 31) + lid * (ocu ? 42 : 62)} Z`} fill={skin} {...ink} />
            )}
          </g>
        ))}
        {/* brows */}
        {[248, 352].map((x, i) => (
          <rect
            key={x}
            x={x - 34}
            y={300 - (ocu ? 52 : 66) + f.browY - 6}
            width={68}
            height={ocu ? 9 : 13}
            fill={ocu ? C.ocuHair : C.ucoHairDark}
            {...ink}
            transform={`rotate(${i === 0 ? -f.brow : f.brow} ${x} ${300 - (ocu ? 52 : 66) + f.browY})`}
          />
        ))}
        {/* glasses: Uco thick black rectangles, Ocu thin rectangles */}
        <g fill="none" stroke={C.ink} strokeWidth={ocu ? 7 : 13}>
          <rect x={ocu ? 196 : 186} y={ocu ? 268 : 260} width={ocu ? 100 : 108} height={ocu ? 62 : 80} rx={ocu ? 10 : 8} />
          <rect x={ocu ? 304 : 306} y={ocu ? 268 : 260} width={ocu ? 100 : 108} height={ocu ? 62 : 80} rx={ocu ? 10 : 8} />
          <line x1={ocu ? 296 : 294} x2={ocu ? 304 : 306} y1={290} y2={290} />
          <line x1={ocu ? 196 : 186} x2={ocu ? 162 : 152} y1={286} y2={280} />
          <line x1={ocu ? 404 : 414} x2={ocu ? 438 : 448} y1={286} y2={280} />
        </g>
        {/* nose */}
        <path d={ocu ? "M 300 322 L 312 360 L 296 364" : "M 304 316 Q 330 360 294 368"} fill="none" {...ink} />
        {/* mouth */}
        {open > 3 ? (
          <g>
            <path d={mouthPath} fill={C.mouth} {...ink} />
            {!ocu && open > 12 && <rect x={300 - w * 0.42} y={my - c - 8} width={w * 0.84} height={12} fill={C.paper} {...ink} />}
            {!ocu && open > 24 && <ellipse cx={300} cy={my + open * 1.15} rx={w * 0.26} ry={Math.min(open * 0.25, 16)} fill={C.tongue} />}
          </g>
        ) : (
          <path d={mouthPath} fill="none" {...ink} />
        )}
        {ocu ? <OcuHair /> : <UcoHair frame={frame} angry={f.shake > 2 && !still} />}
        {!ocu && f.shake > 2 && <AngerMark frame={still ? 0 : frame} />}
        {!ocu && (f.shake > 1 || expression === "worried") && <Sweat frame={still ? 6 : frame} />}
      </g>
      <g transform={`translate(0 ${breathe * 0.5})`}>
        <Arms who={who} gesture={gesture} frame={still ? 0 : frame} mouth={talking ? mouth : 0} gt={gt} glen={glen} />
      </g>
    </svg>
  );
}

function UcoHair({ frame, angry }: { frame: number; angry: boolean }) {
  const t = angry ? Math.sin(frame / 2) * 4 : 0;
  return (
    <g>
      <path
        d={`M 152 300 C 132 220 150 158 196 128 L 176 ${88 + t} L 236 112 L 236 ${62 - t} L 290 102 L 318 ${54 + t} L 340 104 L 396 ${72 - t} L 392 122 L 446 ${110 + t} L 430 164 C 456 196 462 250 448 300
           C 436 254 414 226 386 214 L 380 252 L 350 214 L 330 250 L 304 208 L 278 248 L 262 210 L 226 246 L 222 214 C 190 230 166 258 152 300 Z`}
        fill={C.ucoHair}
        {...ink}
      />
      <path d="M 236 74 L 252 126 M 318 66 L 312 118 M 396 82 L 372 128" fill="none" stroke={C.ucoHairDark} strokeWidth={6} />
    </g>
  );
}

function OcuHair() {
  return (
    <g>
      <path
        d="M 160 300 C 146 210 168 136 230 106 C 270 66 350 58 404 86 C 452 112 464 176 446 230 C 450 256 448 280 440 300
           C 430 250 410 214 376 198 C 336 186 292 196 260 188 C 222 196 184 232 160 300 Z"
        fill={C.ocuHair}
        {...ink}
      />
      <path d="M 238 112 C 290 82 360 78 422 112" fill="none" stroke={C.ocuBlazerDark} strokeWidth={6} />
    </g>
  );
}

function UcoBody() {
  return (
    <g>
      <path d="M 70 1300 L 76 820 C 84 594 182 522 300 516 C 418 522 516 594 524 820 L 530 1300 Z" fill={C.ucoSweater} {...ink} />
      {/* crew neck over a pale yellow collar */}
      <path d="M 300 560 L 232 504 L 214 576 Z" fill={C.ucoCollar} {...ink} />
      <path d="M 300 560 L 368 504 L 386 576 Z" fill={C.ucoCollar} {...ink} />
      <path d="M 222 530 Q 300 604 378 530" fill="none" {...ink} />
    </g>
  );
}

function OcuBody() {
  return (
    <g>
      <path d="M 70 1300 L 76 820 C 84 600 182 528 300 522 C 418 528 516 600 524 820 L 530 1300 Z" fill={C.ocuBlazer} {...ink} />
      <path d="M 220 548 L 300 900 L 380 548 Q 300 526 220 548 Z" fill={C.ocuTurtle} {...ink} />
      <rect x={238} y={452} width={124} height={98} fill={C.ocuTurtle} {...ink} />
      <path d="M 220 548 L 300 900 L 252 704 L 194 646 L 216 604 L 184 574 Z" fill={C.ocuBlazerDark} {...ink} />
      <path d="M 380 548 L 300 900 L 348 704 L 406 646 L 384 604 L 416 574 Z" fill={C.ocuBlazerDark} {...ink} />
    </g>
  );
}

function Hand({ x, y, r = 0, skin }: { x: number; y: number; r?: number; skin: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      {[-30, -12, 6, 24].map((dx, i) => (
        <rect key={i} x={dx} y={-62 + Math.abs(i - 1.5) * 6} width={16} height={56} rx={8} fill={skin} {...ink} />
      ))}
      <rect x={-34} y={-14} width={74} height={56} rx={18} fill={skin} {...ink} />
      <rect x={34} y={-6} width={36} height={16} rx={8} fill={skin} {...ink} transform="rotate(-30 34 0)" />
    </g>
  );
}

function Arms({ who, gesture, frame, mouth, gt, glen }: { who: Who; gesture: ComicGesture; frame: number; mouth: number; gt: number; glen: number }) {
  if (who === "ocu") {
    if (gesture === "lift") {
      // slow cup lift to chest height, linear
      const lift = Math.min(1, gt / Math.max(1, glen)) * 150;
      return (
        <g>
          <path d="M 110 780 C 170 730 300 730 420 790 L 424 870 C 300 820 180 820 114 860 Z" fill={C.ocuBlazer} {...ink} />
          <g transform={`translate(330 ${720 - lift})`}>
            <path d="M 0 0 L 120 0 L 108 170 L 12 170 Z" fill={C.paper} {...ink} />
            <path d="M 6 60 L 114 60 L 108 168 L 12 168 Z" fill="#9BBF5A" {...ink} />
            <path d="M 80 0 L 96 -70" stroke="#2E6B4F" strokeWidth={10} />
            <Hand x={60} y={150} r={180} skin={C.ocuSkin} />
          </g>
        </g>
      );
    }
    // arms crossed (the badge pose)
    return (
      <g>
        <path d="M 96 770 C 160 712 340 712 478 772 L 482 862 C 344 812 176 812 100 870 Z" fill={C.ocuBlazer} {...ink} />
        <path d="M 504 800 C 444 752 262 754 124 808 L 118 896 C 256 846 426 846 500 898 Z" fill={C.ocuBlazerDark} {...ink} />
        <rect x={430} y={760} width={70} height={52} rx={20} fill={C.ocuSkin} {...ink} />
        <rect x={98} y={826} width={70} height={52} rx={20} fill={C.ocuSkin} {...ink} />
      </g>
    );
  }
  if (gesture === "rant" || gesture === "talk") {
    // the badge pose: one hand up with fingers spread, the other on the chest
    const wave = gesture === "rant" ? Math.sin(frame / 3) * 10 + mouth * 20 : Math.sin(frame / 8) * 6;
    return (
      <g>
        <path d={`M 120 700 C 60 640 40 560 60 ${480 - wave}`} fill="none" stroke={C.ink} strokeWidth={74} strokeLinecap="round" />
        <path d={`M 120 700 C 60 640 40 560 60 ${480 - wave}`} fill="none" stroke={C.ucoSweater} strokeWidth={62} strokeLinecap="round" />
        <Hand x={64} y={430 - wave} r={-12} skin={C.ucoSkin} />
        <path d="M 470 720 C 430 760 380 780 340 760" fill="none" stroke={C.ink} strokeWidth={74} strokeLinecap="round" />
        <path d="M 470 720 C 430 760 380 780 340 760" fill="none" stroke={C.ucoSweater} strokeWidth={62} strokeLinecap="round" />
        <Hand x={310} y={770} r={-80} skin={C.ucoSkin} />
      </g>
    );
  }
  if (gesture === "chin") {
    return (
      <g>
        <path d="M 470 720 C 440 620 380 520 330 480" fill="none" stroke={C.ink} strokeWidth={74} strokeLinecap="round" />
        <path d="M 470 720 C 440 620 380 520 330 480" fill="none" stroke={C.ucoSweater} strokeWidth={62} strokeLinecap="round" />
        <Hand x={318} y={470} r={-150} skin={C.ucoSkin} />
      </g>
    );
  }
  if (gesture === "crossed") {
    return (
      <g>
        <path d="M 96 770 C 160 712 340 712 478 772 L 482 862 C 344 812 176 812 100 870 Z" fill={C.ucoSweater} {...ink} />
        <path d="M 504 800 C 444 752 262 754 124 808 L 118 896 C 256 846 426 846 500 898 Z" fill="#C88626" {...ink} />
      </g>
    );
  }
  return null;
}

function AngerMark({ frame }: { frame: number }) {
  const s = 1 + Math.sin(frame / 2.5) * 0.12;
  return (
    <g transform={`translate(430 150) scale(${s})`} fill="none" stroke={C.red} strokeWidth={9} strokeLinecap="round">
      <path d="M -26 -8 Q -8 -8 -8 -26 M 26 -8 Q 8 -8 8 -26 M -26 8 Q -8 8 -8 26 M 26 8 Q 8 8 8 26" />
    </g>
  );
}

function Sweat({ frame }: { frame: number }) {
  return (
    <g>
      {[0, 1].map((i) => {
        const t = ((frame + i * 13) % 26) / 26;
        const x = 120 - t * 60 - i * 20;
        const y = 250 + i * 50 - t * 20;
        return <path key={i} d={`M ${x} ${y} q 12 22 0 30 q -12 -8 0 -30 Z`} fill={C.paper} {...ink} opacity={1 - t} />;
      })}
    </g>
  );
}
