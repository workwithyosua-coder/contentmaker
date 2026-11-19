import React, { useState, useEffect, useRef, useMemo } from 'react';

const FPS = 30;
const BEAT_DURATION = 120;
const TOTAL_FRAMES = 480;

export const SAFE_ZONE = {
  width: 1080,
  height: 1920,
  top: 250,
  bottom: 1260,
  left: 60,
  right: 940,
  followTargetX: 920,
  followTargetY: 780,
};

export const STYLE_PRESETS = {
  'editorial-paper-cutout': {
    id: 'editorial-paper-cutout',
    label: 'Koran Kinetik',
    subtitle: 'Editorial Paper Cutout',
    keyHint: '1',
    palette: {
      canvas: '#F4EFE6',
      ink: '#141619',
      primary: '#D9381E',
      accent: '#FFE600',
      surface: '#FFFFFF',
      ucoBg: '#F5A623',
      ocuBg: '#3A5859',
    },
    editingGrammar: {
      transitionFrames: 6,
      transitionType: 'paper-slide',
      pushInScale: [1.0, 1.04],
      messageMaxWords: 5,
    },
  },
  'tactical-vector-hud': {
    id: 'tactical-vector-hud',
    label: 'Diagram Taktis',
    subtitle: 'Vector HUD Explainer',
    keyHint: '2',
    palette: {
      canvas: '#11161D',
      ink: '#F8FAFC',
      primary: '#1D4ED8',
      accent: '#F59E0B',
      cyan: '#38BDF8',
      surface: '#1E293B',
      danger: '#EF4444',
    },
    editingGrammar: {
      transitionFrames: 8,
      transitionType: 'spring-snap',
      springConfig: { mass: 0.7, damping: 14, stiffness: 200 },
      retractFrame: 98,
      messageMaxWords: 5,
    },
  },
  'midnight-chalk-sketch': {
    id: 'midnight-chalk-sketch',
    label: 'Papan Kapur',
    subtitle: 'Chalkboard Sketch',
    keyHint: '3',
    palette: {
      canvas: '#181A1B',
      ink: '#F5F5F0',
      primary: '#FB7185',
      accent: '#FDE047',
      cyan: '#7DD3FC',
      surface: '#232629',
    },
    editingGrammar: {
      transitionFrames: 12,
      transitionType: 'chalk-wipe',
      drawFrames: 18,
      wipeStartFrame: 116,
      messageMaxWords: 5,
    },
  },
};

export const EPISODE_BEATS = [
  {
    id: 'beat-1',
    index: 0,
    code: 'B1',
    beatType: 'hook-paychecks',
    speaker: 'uco',
    startFrame: 0,
    durationInFrames: BEAT_DURATION,
    importantMessage: {
      kicker: 'WAR 12.12',
      headline: '12X GAJIAN DIJUAL KE ALGORITMA',
      stamp: 'CICILAN 0%',
      tone: 'warning',
    },
    voiceNote:
      'Uco waves glowing 12.12 checkout phone while 12 payday slips drain into the screen.',
  },
  {
    id: 'beat-2',
    index: 1,
    code: 'B2',
    beatType: 'insight-pain-of-paying',
    speaker: 'ocu',
    startFrame: 120,
    durationInFrames: BEAT_DURATION,
    importantMessage: {
      kicker: 'PAIN OF PAYING',
      headline: 'PAYLATER BIKIN OTAK MATI RASA',
      stamp: 'OTAK MATI RASA',
      tone: 'highlight',
    },
    voiceNote:
      'Ocu compares cash pain shock (92%) vs 1-click Face ID numbness (8%) as Uco squints in shock.',
  },
  {
    id: 'beat-3',
    index: 2,
    code: 'B3',
    beatType: 'insight-hidden-fee',
    speaker: 'ocu',
    startFrame: 240,
    durationInFrames: BEAT_DURATION,
    importantMessage: {
      kicker: 'BIAYA LAYANAN',
      headline: '85RB X 12 = 1,02 JUTA',
      stamp: 'MINUS 520RB',
      tone: 'warning',
    },
    voiceNote:
      'Ocu inspects tiny receipt print with a magnifying glass as the 1.02M admin fee overtakes the 500k discount.',
  },
  {
    id: 'beat-4',
    index: 3,
    code: 'B4',
    beatType: 'cta-stinger',
    speaker: 'both',
    startFrame: 360,
    durationInFrames: BEAT_DURATION,
    importantMessage: {
      kicker: 'UCO & OCU',
      headline: 'FOLLOW KONTEN PINTER ANTI ZONK',
      stamp: 'FOLLOW +',
      tone: 'highlight',
    },
    voiceNote:
      'Uco leans in from left while Ocu points straight at the right-rail + Follow target (x=920, y=780).',
  },
];

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function interpolate(frame, inputRange, outputRange) {
  const [inMin, inMax] = inputRange;
  const [outMin, outMax] = outputRange;
  const progress = clamp((frame - inMin) / (inMax - inMin || 1), 0, 1);
  return outMin + (outMax - outMin) * progress;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - clamp(t, 0, 1), 3);
}

function dampedSpring(frame, fps = FPS, { mass = 0.7, damping = 14, stiffness = 200 } = {}) {
  if (frame <= 0) return 0;
  const t = frame / fps;
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const val =
      1 -
      Math.exp(-zeta * omega0 * t) *
        (Math.cos(omegaD * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(omegaD * t));
    return val;
  }
  return 1 - Math.exp(-omega0 * t) * (1 + omega0 * t);
}

function UcoBustSvg({
  variant = 'paper',
  mood = 'loud',
  mouthOpen = false,
  reducedMotion = false,
  drawProgress = 1,
}) {
  const isChalk = variant === 'chalk';
  const isHud = variant === 'hud';
  const stroke = isChalk ? '#FDE047' : '#141619';
  const lineW = isChalk ? 3.2 : 3.5;
  const dash = isChalk ? 420 : undefined;
  const offset = isChalk ? (1 - drawProgress) * 420 : undefined;
  const sweatY = !reducedMotion && mood === 'sweat' ? 2 : 0;

  return (
    <svg
      viewBox="0 0 180 200"
      className="w-full h-full overflow-visible"
      role="img"
      aria-label="Uco character bust"
    >
      {variant === 'paper' && (
        <g transform="translate(5, 6)" opacity="0.95">
          <path
            d="M36 196 L32 132 C32 110 55 104 68 102 L68 88 C52 80 48 64 50 48 C42 36 52 14 78 16 C92 4 128 8 134 30 C148 38 144 58 134 68 C134 82 124 94 114 98 L114 102 C132 104 150 112 152 134 L148 196 Z"
            fill="#141619"
          />
        </g>
      )}
      {variant === 'paper' && (
        <path
          d="M36 196 L32 132 C32 110 55 104 68 102 L68 88 C52 80 48 64 50 48 C42 36 52 14 78 16 C92 4 128 8 134 30 C148 38 144 58 134 68 C134 82 124 94 114 98 L114 102 C132 104 150 112 152 134 L148 196 Z"
          fill="#FFFFFF"
          stroke="#FFFFFF"
          strokeWidth="12"
          strokeLinejoin="round"
        />
      )}

      <g
        stroke={stroke}
        strokeWidth={lineW}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dash}
        strokeDashoffset={offset}
      >
        {/* Mustard sweater */}
        <path
          d="M38 194 L36 134 C38 114 60 108 90 108 C120 108 144 114 146 134 L144 194 Z"
          fill={isChalk ? 'none' : isHud ? '#D97706' : '#F5A623'}
        />
        {/* Pale yellow shirt collar */}
        <path
          d="M68 108 L80 128 L90 116 L100 128 L112 108 Z"
          fill={isChalk ? 'none' : '#FEF08A'}
        />
        {/* Neck & face */}
        <rect
          x="78"
          y="90"
          width="24"
          height="22"
          fill={isChalk ? 'none' : '#F6C296'}
        />
        <path
          d="M56 54 C56 32 124 32 124 54 L122 80 C120 96 106 104 90 104 C74 104 60 96 58 80 Z"
          fill={isChalk ? 'none' : '#F6C296'}
        />
        {/* Messy copper-ginger hair */}
        <path
          d="M52 54 C46 34 60 16 78 20 C84 8 108 8 116 20 C134 16 144 34 132 54 C126 42 118 36 104 38 L94 30 L84 40 C72 38 62 42 52 54 Z"
          fill={isChalk ? 'none' : '#C85A17'}
        />
        {/* Expressive eyebrows */}
        {mood === 'squint' || mood === 'sweat' ? (
          <>
            <path d="M64 52 L82 56" fill="none" />
            <path d="M116 52 L98 56" fill="none" />
          </>
        ) : (
          <>
            <path d="M64 50 L82 55" fill="none" />
            <path d="M116 50 L98 55" fill="none" />
          </>
        )}
        {/* Thick black rectangular glasses */}
        <rect
          x="61"
          y="58"
          width="24"
          height="16"
          rx="2"
          fill={isChalk ? 'none' : '#FFFFFF'}
          stroke={isChalk ? '#FDE047' : '#141619'}
          strokeWidth={isChalk ? 3 : 4}
        />
        <rect
          x="95"
          y="58"
          width="24"
          height="16"
          rx="2"
          fill={isChalk ? 'none' : '#FFFFFF'}
          stroke={isChalk ? '#FDE047' : '#141619'}
          strokeWidth={isChalk ? 3 : 4}
        />
        <line x1="85" y1="65" x2="95" y2="65" strokeWidth="4" />
        {/* Pupils */}
        <circle cx="74" cy="66" r="2.8" fill={stroke} />
        <circle cx="106" cy="66" r="2.8" fill={stroke} />
        {/* Mouth */}
        {mouthOpen ? (
          <path
            d="M74 83 C84 81 96 81 106 83 C106 94 74 94 74 83 Z"
            fill={isChalk ? 'none' : '#7F1D1D'}
          />
        ) : (
          <path
            d={mood === 'sweat' ? 'M76 87 Q90 82 104 87' : 'M78 85 L102 85'}
            fill="none"
          />
        )}
        {/* Sweat drop on Beat 3 */}
        {mood === 'sweat' && (
          <path
            d={`M132 ${46 + sweatY} C137 ${56 + sweatY} 137 ${63 + sweatY} 132 ${63 + sweatY} C127 ${63 + sweatY} 127 ${56 + sweatY} 132 ${46 + sweatY} Z`}
            fill={isChalk ? 'none' : '#38BDF8'}
          />
        )}
        {/* Glowing phone in Beat 1 */}
        {mood === 'phone' && (
          <g transform="translate(132, 92) rotate(12)">
            <rect
              x="0"
              y="0"
              width="30"
              height="48"
              rx="3"
              fill={isChalk ? 'none' : '#FFE600'}
            />
            <line x1="6" y1="12" x2="24" y2="12" />
            <line x1="6" y1="22" x2="20" y2="22" />
            <line x1="6" y1="32" x2="24" y2="32" />
          </g>
        )}
      </g>
    </svg>
  );
}

function OcuBustSvg({
  variant = 'paper',
  mood = 'deadpan',
  mouthOpen = false,
  pointRight = false,
  drawProgress = 1,
}) {
  const isChalk = variant === 'chalk';
  const isHud = variant === 'hud';
  const stroke = isChalk ? '#7DD3FC' : '#141619';
  const lineW = isChalk ? 3.2 : 3.5;
  const dash = isChalk ? 420 : undefined;
  const offset = isChalk ? (1 - drawProgress) * 420 : undefined;

  return (
    <svg
      viewBox="0 0 180 200"
      className="w-full h-full overflow-visible"
      role="img"
      aria-label="Ocu character bust"
    >
      {variant === 'paper' && (
        <g transform="translate(5, 6)" opacity="0.95">
          <path
            d="M34 196 L38 128 C40 110 62 104 74 100 L74 88 C58 80 54 64 56 46 C58 20 82 10 112 16 C128 20 132 38 128 56 C126 78 118 92 108 98 L108 102 C126 106 144 114 146 134 L148 196 Z"
            fill="#141619"
          />
        </g>
      )}
      {variant === 'paper' && (
        <path
          d="M34 196 L38 128 C40 110 62 104 74 100 L74 88 C58 80 54 64 56 46 C58 20 82 10 112 16 C128 20 132 38 128 56 C126 78 118 92 108 98 L108 102 C126 106 144 114 146 134 L148 196 Z"
          fill="#FFFFFF"
          stroke="#FFFFFF"
          strokeWidth="12"
          strokeLinejoin="round"
        />
      )}

      <g
        stroke={stroke}
        strokeWidth={lineW}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dash}
        strokeDashoffset={offset}
      >
        {/* Slate-teal blazer */}
        <path
          d="M38 194 L40 132 C44 114 64 108 90 108 C116 108 138 114 142 132 L144 194 Z"
          fill={isChalk ? 'none' : isHud ? '#1E3A5F' : '#587A7C'}
        />
        {/* Dark teal turtleneck */}
        <path
          d="M72 100 L108 100 L114 194 L66 194 Z"
          fill={isChalk ? 'none' : isHud ? '#0F2942' : '#3A5859'}
        />
        {/* Lapels */}
        <path d="M64 110 L76 148 L60 156" fill="none" />
        <path d="M116 110 L104 148 L120 156" fill="none" />
        {/* Grey-blue face */}
        <path
          d="M58 50 C58 30 122 30 122 50 L120 78 C118 96 104 104 90 104 C76 104 62 96 60 78 Z"
          fill={isChalk ? 'none' : '#9EB7BA'}
        />
        {/* Smooth dark swept-back quiff */}
        <path
          d="M54 52 C50 26 72 10 106 14 C124 16 132 32 124 50 C116 36 104 32 82 34 C68 36 60 42 54 52 Z"
          fill={isChalk ? 'none' : '#25393B'}
        />
        {/* Calm flat eyebrows */}
        <line x1="65" y1="53" x2="82" y2="53" />
        <line x1="98" y1="53" x2="115" y2="53" />
        {/* Thin rectangular glasses + half-lidded eyes */}
        <rect
          x="62"
          y="59"
          width="23"
          height="14"
          rx="1.5"
          fill={isChalk ? 'none' : '#E2ECEC'}
          strokeWidth={isChalk ? 2.5 : 3}
        />
        <rect
          x="95"
          y="59"
          width="23"
          height="14"
          rx="1.5"
          fill={isChalk ? 'none' : '#E2ECEC'}
          strokeWidth={isChalk ? 2.5 : 3}
        />
        <line x1="85" y1="65" x2="95" y2="65" />
        {/* Half-lidded eye line */}
        <line x1="64" y1="64" x2="83" y2="64" />
        <line x1="97" y1="64" x2="116" y2="64" />
        <circle cx="74" cy="68" r="2.2" fill={stroke} />
        <circle cx="106" cy="68" r="2.2" fill={stroke} />
        {/* Deadpan smirk / small talking mouth */}
        {mouthOpen ? (
          <ellipse cx="90" cy="86" rx="9" ry="4" fill={isChalk ? 'none' : '#25393B'} />
        ) : (
          <path d="M80 86 Q92 88 103 83" fill="none" />
        )}
        {/* Magnifying glass in Beat 3 */}
        {mood === 'magnifier' && (
          <g transform="translate(8, 108)">
            <circle
              cx="22"
              cy="22"
              r="18"
              fill={isChalk ? 'none' : '#FFE600'}
              fillOpacity="0.35"
            />
            <line x1="35" y1="35" x2="50" y2="50" strokeWidth="5" />
          </g>
        )}
        {/* Pointing hand right for Beat 4 CTA */}
        {pointRight && (
          <g transform="translate(132, 118)">
            <path
              d="M0 10 L36 10 C42 10 42 20 36 20 L18 20 L18 30 L0 30 Z"
              fill={isChalk ? 'none' : '#9EB7BA'}
            />
          </g>
        )}
      </g>
    </svg>
  );
}

function BeatPropVisual({ styleId, beatIndex, localFrame, reducedMotion }) {
  const springVal = reducedMotion ? 1 : dampedSpring(localFrame - 6);
  const drawProgress = reducedMotion ? 1 : clamp(localFrame / 18, 0, 1);

  if (styleId === 'editorial-paper-cutout') {
    const stroke = '#141619';
    if (beatIndex === 0) {
      const drained = reducedMotion ? 8 : Math.min(12, Math.floor(localFrame / 8));
      return (
        <div className="w-full px-3">
          <div className="bg-white border-2 border-[#141619] p-2 shadow-[4px_4px_0_#141619]">
            <div className="flex items-center justify-between text-[10px] font-mono font-bold text-[#141619] mb-1.5">
              <span>SLIP GAJIAN 12 BULAN</span>
              <span className="text-[#D9381E]">{drained}/12 TERSERAP</span>
            </div>
            <div className="grid grid-cols-6 gap-1">
              {Array.from({ length: 12 }).map((_, i) => {
                const isGone = i < drained;
                return (
                  <div
                    key={i}
                    className="h-5 border border-[#141619] flex items-center justify-center text-[9px] font-mono font-bold"
                    style={{
                      backgroundColor: isGone ? '#D9381E' : '#F4EFE6',
                      color: isGone ? '#FFFFFF' : '#141619',
                      opacity: isGone ? 0.95 : 1,
                    }}
                  >
                    B{i + 1}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }
    if (beatIndex === 1) {
      return (
        <div className="w-full px-3 grid grid-cols-2 gap-2">
          <div className="bg-white border-2 border-[#141619] p-2 shadow-[4px_4px_0_#141619]">
            <div className="text-[9px] font-mono font-bold text-[#D9381E]">BAYAR CASH</div>
            <div className="text-sm font-black text-[#141619] leading-tight">OTAK SAKIT</div>
            <div className="mt-1 h-2 bg-[#F4EFE6] border border-[#141619]">
              <div className="h-full bg-[#D9381E]" style={{ width: '92%' }} />
            </div>
          </div>
          <div className="bg-[#FFE600] border-2 border-[#141619] p-2 shadow-[4px_4px_0_#141619]">
            <div className="text-[9px] font-mono font-bold text-[#141619]">1-KLIK FACE ID</div>
            <div className="text-sm font-black text-[#141619] leading-tight">MATI RASA</div>
            <div className="mt-1 h-2 bg-white border border-[#141619]">
              <div className="h-full bg-[#141619]" style={{ width: '8%' }} />
            </div>
          </div>
        </div>
      );
    }
    if (beatIndex === 2) {
      const adminWidth = reducedMotion ? 100 : interpolate(localFrame, [10, 48], [15, 100]);
      return (
        <div className="w-full px-3">
          <div className="bg-white border-2 border-[#141619] p-2.5 shadow-[4px_4px_0_#141619] space-y-1.5">
            <div className="flex justify-between text-[10px] font-mono font-bold text-[#141619]">
              <span>DISKON PROMO</span>
              <span>+RP 500RB</span>
            </div>
            <div className="h-3 bg-[#F4EFE6] border border-[#141619]">
              <div className="h-full bg-[#15803D]" style={{ width: '49%' }} />
            </div>
            <div className="flex justify-between text-[10px] font-mono font-bold text-[#D9381E] pt-1">
              <span>BIAYA LAYANAN 12X</span>
              <span>-RP 1,02JT</span>
            </div>
            <div className="h-3 bg-[#F4EFE6] border border-[#141619]">
              <div className="h-full bg-[#D9381E]" style={{ width: `${adminWidth}%` }} />
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="w-full px-3 flex justify-end">
        <div
          className="bg-[#FFE600] border-2 border-[#141619] px-3 py-2 shadow-[4px_4px_0_#141619] flex items-center gap-2"
          style={{ transform: `scale(${0.92 + 0.08 * clamp(springVal, 0, 1)})` }}
        >
          <span className="text-xs font-black uppercase text-[#141619]">TAP + DI KANAN</span>
          <svg width="24" height="16" viewBox="0 0 24 16" aria-hidden="true">
            <path
              d="M2 8 H20 M14 2 L21 8 L14 14"
              fill="none"
              stroke={stroke}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    );
  }

  if (styleId === 'tactical-vector-hud') {
    const isRetracting = !reducedMotion && localFrame >= 98;
    const lineScale = isRetracting ? interpolate(localFrame, [98, 110], [1, 0]) : clamp(springVal, 0, 1);

    if (beatIndex === 0) {
      const blocks = reducedMotion ? 9 : Math.min(12, Math.floor(localFrame / 8));
      return (
        <div className="w-full px-3">
          <div className="border-2 border-[#38BDF8] bg-[#1E293B] p-2">
            <div className="flex justify-between font-mono text-[9px] text-[#38BDF8] mb-1">
              <span>PAYCHECK DRAIN // 12M</span>
              <span className="text-[#F59E0B]">-{blocks} BULAN</span>
            </div>
            <div className="grid grid-cols-12 gap-0.5 h-5">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    backgroundColor: i < blocks ? '#EF4444' : '#38BDF8',
                    opacity: i < blocks ? 0.95 : 0.25,
                  }}
                />
              ))}
            </div>
          </div>
          <div
            className="h-0.5 bg-[#F59E0B] mt-1 origin-left"
            style={{ transform: `scaleX(${lineScale})` }}
          />
        </div>
      );
    }
    if (beatIndex === 1) {
      const cashBar = reducedMotion ? 92 : interpolate(localFrame, [6, 32], [10, 92]);
      const bnplBar = reducedMotion ? 8 : interpolate(localFrame, [6, 32], [40, 8]);
      return (
        <div className="w-full px-3">
          <div className="border-2 border-[#1D4ED8] bg-[#1E293B] p-2 space-y-1.5 font-mono text-[9px]">
            <div className="flex justify-between text-[#F8FAFC]">
              <span>INSULAR PAIN (CASH)</span>
              <span className="text-[#EF4444]">{Math.round(cashBar)}%</span>
            </div>
            <div className="h-2 bg-[#0F172A]">
              <div className="h-full bg-[#EF4444]" style={{ width: `${cashBar}%` }} />
            </div>
            <div className="flex justify-between text-[#F8FAFC]">
              <span>INSULAR PAIN (PAYLATER)</span>
              <span className="text-[#38BDF8]">{Math.round(bnplBar)}%</span>
            </div>
            <div className="h-2 bg-[#0F172A]">
              <div className="h-full bg-[#38BDF8]" style={{ width: `${bnplBar}%` }} />
            </div>
          </div>
        </div>
      );
    }
    if (beatIndex === 2) {
      const feePct = reducedMotion ? 100 : interpolate(localFrame, [8, 44], [12, 100]);
      return (
        <div className="w-full px-3">
          <div className="border-2 border-[#F59E0B] bg-[#1E293B] p-2 font-mono text-[9px] space-y-1">
            <div className="flex justify-between text-[#F8FAFC]">
              <span>PROMO DISCOUNT</span>
              <span className="text-[#38BDF8]">500RB</span>
            </div>
            <div className="h-2.5 bg-[#0F172A]">
              <div className="h-full bg-[#38BDF8]" style={{ width: '49%' }} />
            </div>
            <div className="flex justify-between text-[#F59E0B]">
              <span>ADMIN FEE (85RB X 12)</span>
              <span>1,02JT</span>
            </div>
            <div className="h-2.5 bg-[#0F172A]">
              <div className="h-full bg-[#EF4444]" style={{ width: `${feePct}%` }} />
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="w-full px-3 flex justify-end">
        <div className="border-2 border-[#F59E0B] bg-[#1E293B] px-2.5 py-1.5 flex items-center gap-2 font-mono text-[10px] font-bold text-[#F59E0B]">
          <span>LOCK TARGET + FOLLOW</span>
          <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
            <path d="M1 7 H17 M12 2 L18 7 L12 12" fill="none" stroke="#F59E0B" strokeWidth="2.5" />
          </svg>
        </div>
      </div>
    );
  }

  // midnight-chalk-sketch
  const chalkDash = 260;
  const chalkOffset = (1 - drawProgress) * chalkDash;
  return (
    <div className="w-full px-3">
      <div className="border border-dashed border-[#F5F5F0]/50 p-2 bg-[#232629]/70">
        <svg viewBox="0 0 240 46" className="w-full h-11" aria-hidden="true">
          <path
            d="M8 38 Q120 34 232 38"
            fill="none"
            stroke="#FDE047"
            strokeWidth="2.5"
            strokeDasharray={chalkDash}
            strokeDashoffset={chalkOffset}
          />
          <text
            x="120"
            y="24"
            textAnchor="middle"
            fill={beatIndex === 2 ? '#FB7185' : '#F5F5F0'}
            fontSize="13"
            fontFamily="monospace"
            fontWeight="700"
          >
            {beatIndex === 0 && '12x GAJIAN -> 0% TRAP'}
            {beatIndex === 1 && 'CASH (SAKIT) vs 1-KLIK (KEBAL)'}
            {beatIndex === 2 && '500rb - 1.020rb = -520rb'}
            {beatIndex === 3 && 'FOLLOW UCO & OCU ->'}
          </text>
        </svg>
      </div>
    </div>
  );
}

function StageMonitor({
  styleId,
  frame,
  beats,
  showSafeZone,
  reducedMotion,
  isFocused,
  onSelectFocus,
}) {
  const preset = STYLE_PRESETS[styleId];
  const beatIndex = clamp(Math.floor(frame / BEAT_DURATION), 0, beats.length - 1);
  const beat = beats[beatIndex];
  const localFrame = frame % BEAT_DURATION;

  const isUcoActive = beat.speaker === 'uco' || beat.speaker === 'both';
  const isOcuActive = beat.speaker === 'ocu' || beat.speaker === 'both';
  const mouthPulse = !reducedMotion && Math.floor(localFrame / 4) % 2 === 0;

  const ucoMood =
    beatIndex === 0 ? 'phone' : beatIndex === 1 ? 'squint' : beatIndex === 2 ? 'sweat' : 'loud';
  const ocuMood = beatIndex === 2 ? 'magnifier' : 'deadpan';
  const ocuPointsRight = beatIndex === 3;

  // Style-specific deterministic motion
  const paperSlideX =
    styleId === 'editorial-paper-cutout' && !reducedMotion
      ? (1 - easeOutCubic(localFrame / 6)) * 42
      : 0;
  const paperZoom =
    styleId === 'editorial-paper-cutout' && !reducedMotion
      ? interpolate(localFrame, [0, BEAT_DURATION], [1.0, 1.04])
      : 1;
  const highlightSweep =
    styleId === 'editorial-paper-cutout'
      ? reducedMotion
        ? 100
        : interpolate(localFrame, [14, 28], [0, 100])
      : 0;
  const stampScale =
    styleId === 'editorial-paper-cutout'
      ? reducedMotion
        ? 1
        : localFrame < 34
        ? 0
        : interpolate(localFrame, [34, 42], [1.65, 1.0])
      : 1;

  const hudSpring =
    styleId === 'tactical-vector-hud' && !reducedMotion ? dampedSpring(localFrame) : 1;

  const chalkDraw =
    styleId === 'midnight-chalk-sketch' && !reducedMotion
      ? clamp(localFrame / 18, 0, 1)
      : 1;
  const chalkBoilDeg =
    styleId === 'midnight-chalk-sketch' && !reducedMotion
      ? Math.floor(localFrame / 4) % 2 === 0
        ? -0.6
        : 0.6
      : 0;
  const chalkWipeOpacity =
    styleId === 'midnight-chalk-sketch' && !reducedMotion && localFrame >= 116
      ? interpolate(localFrame, [116, 119], [1, 0])
      : 1;

  const bgStyle =
    styleId === 'editorial-paper-cutout'
      ? {
          backgroundColor: '#F4EFE6',
          backgroundImage: 'radial-gradient(rgba(20,22,25,0.14) 1px, transparent 1px)',
          backgroundSize: '10px 10px',
        }
      : styleId === 'tactical-vector-hud'
      ? {
          backgroundColor: '#11161D',
          backgroundImage:
            'linear-gradient(rgba(56,189,248,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.06) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }
      : {
          backgroundColor: '#181A1B',
          backgroundImage: 'radial-gradient(rgba(245,245,240,0.08) 1px, transparent 1px)',
          backgroundSize: '12px 12px',
        };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onSelectFocus}
          aria-pressed={isFocused}
          className="cursor-pointer min-h-[44px] px-3 py-1.5 border-2 text-left flex items-center gap-2 transition-colors focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#FFE600]"
          style={{
            borderColor: isFocused ? '#FFE600' : '#2D3540',
            backgroundColor: isFocused ? '#1E242D' : '#161B22',
            color: '#F4F5F7',
          }}
        >
          <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-[#FFE600] text-[#141619]">
            Key {preset.keyHint}
          </span>
          <span className="font-bold text-sm">{preset.label}</span>
        </button>
        <span className="font-mono text-xs text-[#A3B1BC]">
          {beat.code} · f.{String(localFrame).padStart(3, '0')}
        </span>
      </div>

      {/* 9:16 Stage Frame */}
      <div
        className="relative w-full mx-auto overflow-hidden border-2 select-none"
        style={{
          aspectRatio: '9 / 16',
          maxHeight: '64vh',
          borderColor: isFocused ? '#FFE600' : '#2D3540',
          ...bgStyle,
        }}
      >
        {/* Animated Stage Content clamped to TikTok Safe Zone (top 13% -> bottom 34.4%) */}
        <div
          className="absolute inset-0 flex flex-col justify-between px-[5.5%] pt-[14%] pb-[35%]"
          style={{
            transform:
              styleId === 'editorial-paper-cutout'
                ? `translateX(${paperSlideX}px) scale(${paperZoom})`
                : styleId === 'midnight-chalk-sketch'
                ? `rotate(${chalkBoilDeg}deg)`
                : undefined,
            opacity: chalkWipeOpacity,
          }}
        >
          {/* TOP: Important Message Only (max 5 words) */}
          <div
            className="w-full"
            style={{
              transform:
                styleId === 'tactical-vector-hud'
                  ? `scale(${0.92 + 0.08 * clamp(hudSpring, 0, 1)})`
                  : undefined,
            }}
          >
            {styleId === 'editorial-paper-cutout' && (
              <div className="bg-white border-2 border-[#141619] p-2.5 shadow-[5px_5px_0_#141619] relative">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#D9381E]">
                    {beat.importantMessage.kicker}
                  </span>
                  {stampScale > 0 && (
                    <span
                      className="px-1.5 py-0.5 text-[9px] font-black uppercase bg-[#D9381E] text-white border border-[#141619]"
                      style={{ transform: `rotate(-3deg) scale(${stampScale})` }}
                    >
                      {beat.importantMessage.stamp}
                    </span>
                  )}
                </div>
                <div className="relative inline-block">
                  <span
                    className="absolute inset-y-0 left-0 bg-[#FFE600]"
                    style={{ width: `${highlightSweep}%` }}
                    aria-hidden="true"
                  />
                  <p className="relative text-sm sm:text-base font-black uppercase leading-tight text-[#141619] px-1">
                    {beat.importantMessage.headline}
                  </p>
                </div>
              </div>
            )}

            {styleId === 'tactical-vector-hud' && (
              <div className="border-2 border-[#1D4ED8] bg-[#1E293B] p-2.5">
                <div className="flex items-center justify-between font-mono text-[10px] mb-1">
                  <span className="text-[#38BDF8] font-bold">
                    [{beat.importantMessage.kicker}]
                  </span>
                  <span className="px-1.5 py-0.5 bg-[#F59E0B] text-[#141619] font-black">
                    {beat.importantMessage.stamp}
                  </span>
                </div>
                <p className="text-sm sm:text-base font-black uppercase leading-tight text-[#F8FAFC]">
                  {beat.importantMessage.headline}
                </p>
              </div>
            )}

            {styleId === 'midnight-chalk-sketch' && (
              <div className="p-2 border-b-2 border-dashed border-[#FDE047]">
                <div className="font-mono text-[10px] uppercase text-[#7DD3FC] mb-0.5">
                  {beat.importantMessage.kicker}
                </div>
                <p className="text-sm sm:text-base font-black uppercase leading-tight text-[#F5F5F0]">
                  {beat.importantMessage.headline}
                </p>
              </div>
            )}
          </div>

          {/* MIDDLE: Uco & Ocu Cast Stage */}
          <div className="grid grid-cols-2 gap-2 items-end my-auto py-1">
            {/* Uco Slot */}
            <div
              className="relative flex flex-col items-center"
              style={{
                transform:
                  styleId === 'editorial-paper-cutout'
                    ? `scale(${isUcoActive ? 1.07 : 0.94}) rotate(${isUcoActive ? -2 : 0}deg)`
                    : undefined,
                opacity: isUcoActive ? 1 : 0.6,
              }}
            >
              {styleId === 'tactical-vector-hud' && (
                <div className="w-full border-2 border-[#F59E0B] bg-[#161B22] p-1.5">
                  <div className="flex items-center justify-between font-mono text-[9px] text-[#F59E0B] mb-1">
                    <span>UCO</span>
                    <span>{isUcoActive ? 'SPEAKING' : 'IDLE'}</span>
                  </div>
                  <div className="h-24 w-full">
                    <UcoBustSvg
                      variant="hud"
                      mood={ucoMood}
                      mouthOpen={isUcoActive && mouthPulse}
                      reducedMotion={reducedMotion}
                    />
                  </div>
                  {/* Deterministic frame-driven voice waveform */}
                  <div className="flex items-end gap-0.5 h-3 mt-1">
                    {[0.4, 0.9, 0.6, 1, 0.5, 0.8].map((base, idx) => {
                      const h = isUcoActive
                        ? reducedMotion
                          ? base * 10
                          : 3 + ((Math.sin(localFrame * 0.5 + idx * 1.4) + 1) / 2) * 9
                        : 2;
                      return (
                        <div
                          key={idx}
                          className="flex-1 bg-[#F59E0B]"
                          style={{ height: `${h}px` }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {styleId === 'editorial-paper-cutout' && (
                <>
                  <div className="h-28 w-full">
                    <UcoBustSvg
                      variant="paper"
                      mood={ucoMood}
                      mouthOpen={isUcoActive && mouthPulse}
                      reducedMotion={reducedMotion}
                    />
                  </div>
                  <span className="mt-0.5 px-1.5 py-0.5 text-[9px] font-mono font-bold bg-[#141619] text-[#FFE600]">
                    UCO {isUcoActive ? 'ON MIC' : ''}
                  </span>
                </>
              )}

              {styleId === 'midnight-chalk-sketch' && (
                <>
                  <div className="h-28 w-full">
                    <UcoBustSvg
                      variant="chalk"
                      mood={ucoMood}
                      mouthOpen={isUcoActive && mouthPulse}
                      reducedMotion={reducedMotion}
                      drawProgress={chalkDraw}
                    />
                  </div>
                  <span className="font-mono text-[9px] text-[#FDE047]">UCO</span>
                </>
              )}
            </div>

            {/* Ocu Slot */}
            <div
              className="relative flex flex-col items-center"
              style={{
                transform:
                  styleId === 'editorial-paper-cutout'
                    ? `scale(${isOcuActive ? 1.07 : 0.94}) rotate(${isOcuActive ? 1.5 : 0}deg)`
                    : undefined,
                opacity: isOcuActive ? 1 : 0.6,
              }}
            >
              {styleId === 'tactical-vector-hud' && (
                <div className="w-full border-2 border-[#38BDF8] bg-[#161B22] p-1.5">
                  <div className="flex items-center justify-between font-mono text-[9px] text-[#38BDF8] mb-1">
                    <span>OCU</span>
                    <span>{isOcuActive ? 'SPEAKING' : 'IDLE'}</span>
                  </div>
                  <div className="h-24 w-full">
                    <OcuBustSvg
                      variant="hud"
                      mood={ocuMood}
                      mouthOpen={isOcuActive && mouthPulse}
                      pointRight={ocuPointsRight}
                    />
                  </div>
                  <div className="flex items-end gap-0.5 h-3 mt-1">
                    {[0.5, 0.7, 0.4, 0.85, 0.6, 0.5].map((base, idx) => {
                      const h = isOcuActive
                        ? reducedMotion
                          ? base * 10
                          : 3 + ((Math.cos(localFrame * 0.45 + idx * 1.3) + 1) / 2) * 9
                        : 2;
                      return (
                        <div
                          key={idx}
                          className="flex-1 bg-[#38BDF8]"
                          style={{ height: `${h}px` }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {styleId === 'editorial-paper-cutout' && (
                <>
                  <div className="h-28 w-full">
                    <OcuBustSvg
                      variant="paper"
                      mood={ocuMood}
                      mouthOpen={isOcuActive && mouthPulse}
                      pointRight={ocuPointsRight}
                    />
                  </div>
                  <span className="mt-0.5 px-1.5 py-0.5 text-[9px] font-mono font-bold bg-[#3A5859] text-white border border-[#141619]">
                    OCU {isOcuActive ? 'ON MIC' : ''}
                  </span>
                </>
              )}

              {styleId === 'midnight-chalk-sketch' && (
                <>
                  <div className="h-28 w-full">
                    <OcuBustSvg
                      variant="chalk"
                      mood={ocuMood}
                      mouthOpen={isOcuActive && mouthPulse}
                      pointRight={ocuPointsRight}
                      drawProgress={chalkDraw}
                    />
                  </div>
                  <span className="font-mono text-[9px] text-[#7DD3FC]">OCU</span>
                </>
              )}
            </div>
          </div>

          {/* LOWER SAFE-ZONE: Beat Diagram / Prop */}
          <BeatPropVisual
            styleId={styleId}
            beatIndex={beatIndex}
            localFrame={localFrame}
            reducedMotion={reducedMotion}
          />
        </div>

        {/* Optional TikTok UI Safe-Zone Overlay */}
        {showSafeZone && (
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
            <div
              className="absolute top-0 inset-x-0 bg-[#EF4444]/25 border-b border-dashed border-[#FFE600] flex items-end justify-center pb-0.5"
              style={{ height: '13%' }}
            >
              <span className="font-mono text-[9px] font-bold bg-[#141619] text-[#FFE600] px-1">
                TOP UNSAFE y&lt;250px
              </span>
            </div>
            <div
              className="absolute right-0 top-[13%] bottom-[34.4%] bg-[#EF4444]/20 border-l border-dashed border-[#FFE600]"
              style={{ width: '13%' }}
            />
            {/* TikTok + Follow Target at x=920, y=780 (~40.6% height) */}
            <div
              className="absolute right-1.5 flex items-center justify-center w-7 h-7 rounded-full border-2 border-[#FFE600] bg-[#D9381E] text-white font-black text-xs"
              style={{ top: '40.6%', transform: 'translateY(-50%)' }}
            >
              +
            </div>
            <div
              className="absolute bottom-0 inset-x-0 bg-[#EF4444]/25 border-t border-dashed border-[#FFE600] flex items-start justify-center pt-1"
              style={{ height: '34.4%' }}
            >
              <span className="font-mono text-[9px] font-bold bg-[#141619] text-[#FFE600] px-1">
                CAPTION UNSAFE y&gt;1260px
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function UcoOcuStyleLabWithCast() {
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState('compare'); // 'compare' | 'focus'
  const [activeStyle, setActiveStyle] = useState('editorial-paper-cutout');
  const [frame, setFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [showSafeZone, setShowSafeZone] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Beat search + sandbox state
  const [searchQuery, setSearchQuery] = useState('');
  const [sandboxBeatIdx, setSandboxBeatIdx] = useState(0);
  const [customBeats, setCustomBeats] = useState(EPISODE_BEATS);
  const [headlineInput, setHeadlineInput] = useState(
    EPISODE_BEATS[0].importantMessage.headline
  );
  const [copyStatus, setCopyStatus] = useState('');

  const rafRef = useRef(null);
  const lastTimeRef = useRef(null);

  useEffect(() => {
    const mq =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    if (mq && mq.matches) {
      setReducedMotion(true);
      setIsPlaying(false);
    }
    const timer = setTimeout(() => setIsLoading(false), 200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTimeRef.current = null;
      return;
    }
    const step = (now) => {
      if (lastTimeRef.current == null) lastTimeRef.current = now;
      const elapsed = now - lastTimeRef.current;
      if (elapsed >= 1000 / FPS) {
        const framesToAdvance = Math.floor(elapsed / (1000 / FPS));
        lastTimeRef.current = now;
        setFrame((prev) => (prev + framesToAdvance) % TOTAL_FRAMES);
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setFrame((f) => (Math.floor(f / BEAT_DURATION) * BEAT_DURATION + BEAT_DURATION) % TOTAL_FRAMES);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setFrame(
          (f) =>
            (Math.floor(f / BEAT_DURATION) * BEAT_DURATION - BEAT_DURATION + TOTAL_FRAMES) %
            TOTAL_FRAMES
        );
      } else if (e.key === '1') {
        setActiveStyle('editorial-paper-cutout');
      } else if (e.key === '2') {
        setActiveStyle('tactical-vector-hud');
      } else if (e.key === '3') {
        setActiveStyle('midnight-chalk-sketch');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const wordCount = useMemo(
    () => headlineInput.trim().split(/\s+/).filter(Boolean).length,
    [headlineInput]
  );
  const headlineTooLong = wordCount > 5;

  const filteredBeats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return customBeats;
    return customBeats.filter(
      (b) =>
        b.importantMessage.headline.toLowerCase().includes(q) ||
        b.importantMessage.kicker.toLowerCase().includes(q) ||
        b.speaker.toLowerCase().includes(q)
    );
  }, [customBeats, searchQuery]);

  const handleHeadlineChange = (val) => {
    setHeadlineInput(val);
    const words = val.trim().split(/\s+/).filter(Boolean);
    if (words.length > 0 && words.length <= 5) {
      setCustomBeats((prev) =>
        prev.map((b, idx) =>
          idx === sandboxBeatIdx
            ? {
                ...b,
                importantMessage: { ...b.importantMessage, headline: val.toUpperCase() },
              }
            : b
        )
      );
    }
  };

  const handleAutoTrim = () => {
    const trimmed = headlineInput
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
      .join(' ')
      .toUpperCase();
    handleHeadlineChange(trimmed);
  };

  const handleCopyConfig = async () => {
    const payload = JSON.stringify(
      {
        safeZone: SAFE_ZONE,
        styles: [
          STYLE_PRESETS['editorial-paper-cutout'],
          STYLE_PRESETS['tactical-vector-hud'],
        ],
        beats: customBeats,
      },
      null,
      2
    );
    try {
      await navigator.clipboard.writeText(payload);
      setCopyStatus('Copied Remotion config to clipboard.');
    } catch {
      setCopyStatus('Clipboard blocked. Copy directly from this source file.');
    }
    setTimeout(() => setCopyStatus(''), 2500);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0E1116] text-[#F4F5F7] flex items-center justify-center font-mono text-sm">
        Loading Remotion Style Lab...
      </div>
    );
  }

  const currentBeatIdx = clamp(Math.floor(frame / BEAT_DURATION), 0, customBeats.length - 1);
  const currentBeat = customBeats[currentBeatIdx];
  const visibleStyles =
    viewMode === 'compare'
      ? ['editorial-paper-cutout', 'tactical-vector-hud', 'midnight-chalk-sketch']
      : [activeStyle];

  return (
    <div className="min-h-screen bg-[#0E1116] text-[#F4F5F7] overflow-x-hidden font-sans">
      <header className="border-b-2 border-[#232A35] bg-[#161B22] px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-black tracking-tight text-[#F4F5F7]">
              Dapur Konten: Uco &amp; Ocu Style Lab
            </h1>
            <p className="font-mono text-xs text-[#A3B1BC]">
              1080x1920 · 30fps · 480 frames · Cicilan 0%, Gaji Minus
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode((m) => (m === 'compare' ? 'focus' : 'compare'))}
              className="cursor-pointer min-h-[44px] px-3 border-2 border-[#FFE600] bg-[#FFE600] text-[#141619] font-bold text-xs uppercase focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-white"
            >
              {viewMode === 'compare' ? 'Focus Stage (1-Up)' : 'Compare All (3-Up)'}
            </button>
            <button
              type="button"
              onClick={() => setShowSafeZone((s) => !s)}
              aria-pressed={showSafeZone}
              className="cursor-pointer min-h-[44px] px-3 border-2 border-[#303846] bg-[#0E1116] text-[#F4F5F7] font-mono text-xs focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#FFE600]"
            >
              TikTok Safe Zone: {showSafeZone ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              onClick={() => setReducedMotion((r) => !r)}
              aria-pressed={reducedMotion}
              className="cursor-pointer min-h-[44px] px-3 border-2 border-[#303846] bg-[#0E1116] text-[#F4F5F7] font-mono text-xs focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#FFE600]"
            >
              Reduced Motion: {reducedMotion ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left/Center: 9:16 Preview Monitors */}
        <section className="lg:col-span-8 flex flex-col gap-4" aria-label="Style preview monitors">
          <div
            className={
              viewMode === 'compare'
                ? 'grid grid-cols-1 md:grid-cols-3 gap-4'
                : 'max-w-sm mx-auto w-full'
            }
          >
            {visibleStyles.map((sid) => (
              <StageMonitor
                key={sid}
                styleId={sid}
                frame={frame}
                beats={customBeats}
                showSafeZone={showSafeZone}
                reducedMotion={reducedMotion}
                isFocused={activeStyle === sid}
                onSelectFocus={() => setActiveStyle(sid)}
              />
            ))}
          </div>

          {/* Transport Controls */}
          <nav
            aria-label="Timeline transport"
            className="border-2 border-[#232A35] bg-[#161B22] p-3 flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPlaying((p) => !p)}
                  className="cursor-pointer min-h-[44px] min-w-[96px] px-3 border-2 border-[#FFE600] bg-[#FFE600] text-[#141619] font-black text-xs uppercase focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-white"
                >
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  type="button"
                  onClick={() => setFrame((f) => (f - BEAT_DURATION + TOTAL_FRAMES) % TOTAL_FRAMES)}
                  className="cursor-pointer min-h-[44px] min-w-[44px] px-3 border-2 border-[#303846] bg-[#0E1116] text-xs font-mono focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#FFE600]"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setFrame((f) => (f + BEAT_DURATION) % TOTAL_FRAMES)}
                  className="cursor-pointer min-h-[44px] min-w-[44px] px-3 border-2 border-[#303846] bg-[#0E1116] text-xs font-mono focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#FFE600]"
                >
                  Next
                </button>
              </div>
              <div className="font-mono text-xs text-[#FFE600]">
                Frame {String(frame).padStart(3, '0')} / {TOTAL_FRAMES} · {currentBeat.code}
              </div>
            </div>

            <label className="flex flex-col gap-1">
              <span className="sr-only">Scrub timeline frame</span>
              <input
                type="range"
                min={0}
                max={TOTAL_FRAMES - 1}
                value={frame}
                onChange={(e) => setFrame(Number(e.target.value))}
                className="w-full cursor-pointer accent-[#FFE600]"
              />
            </label>
          </nav>
        </section>

        {/* Right: Important Message Sandbox + Beat Filter */}
        <aside className="lg:col-span-4 flex flex-col gap-4">
          <div className="border-2 border-[#232A35] bg-[#161B22] p-4 flex flex-col gap-3">
            <h2 className="text-sm font-black uppercase tracking-wide text-[#FFE600]">
              Important Message Sandbox
            </h2>
            <p className="text-xs text-[#A3B1BC]">
              Strict 5-word ceiling keeps the 9:16 frame focused on high-signal takeaways.
            </p>

            <div className="grid grid-cols-4 gap-1.5">
              {customBeats.map((b, idx) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setSandboxBeatIdx(idx);
                    setHeadlineInput(b.importantMessage.headline);
                    setFrame(b.startFrame);
                  }}
                  aria-current={sandboxBeatIdx === idx ? 'true' : undefined}
                  className="cursor-pointer min-h-[44px] border-2 font-mono text-xs font-bold focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#FFE600]"
                  style={{
                    borderColor: sandboxBeatIdx === idx ? '#FFE600' : '#303846',
                    backgroundColor: sandboxBeatIdx === idx ? '#FFE600' : '#0E1116',
                    color: sandboxBeatIdx === idx ? '#141619' : '#F4F5F7',
                  }}
                >
                  {b.code}
                </button>
              ))}
            </div>

            <label className="flex flex-col gap-1 text-xs font-mono text-[#A3B1BC]">
              Headline ({wordCount}/5 words)
              <input
                type="text"
                value={headlineInput}
                onChange={(e) => handleHeadlineChange(e.target.value)}
                aria-invalid={headlineTooLong}
                className="min-h-[44px] px-3 bg-[#0E1116] border-2 text-[#F4F5F7] font-sans text-sm focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#FFE600]"
                style={{ borderColor: headlineTooLong ? '#EF4444' : '#303846' }}
              />
            </label>

            {headlineTooLong && (
              <div
                role="alert"
                className="border-2 border-[#EF4444] bg-[#7F1D1D] text-[#FEF2F2] p-2.5 text-xs flex items-center justify-between gap-2"
              >
                <span>Exceeds 5-word limit ({wordCount} words).</span>
                <button
                  type="button"
                  onClick={handleAutoTrim}
                  className="cursor-pointer min-h-[44px] px-2.5 bg-[#FFE600] text-[#141619] font-bold uppercase shrink-0"
                >
                  Auto-Trim to 5 Words
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleCopyConfig}
              className="cursor-pointer min-h-[44px] w-full border-2 border-[#303846] bg-[#0E1116] hover:border-[#FFE600] text-[#F4F5F7] font-mono text-xs font-bold uppercase focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#FFE600]"
            >
              Copy Remotion Config
            </button>
            {copyStatus && (
              <p role="status" className="font-mono text-xs text-[#FFE600]">
                {copyStatus}
              </p>
            )}
          </div>

          {/* Beat Navigator with Search & Empty State */}
          <div className="border-2 border-[#232A35] bg-[#161B22] p-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-mono text-[#A3B1BC]">
              Filter Beats
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search speaker or keyword..."
                className="min-h-[44px] px-3 bg-[#0E1116] border-2 border-[#303846] text-[#F4F5F7] text-sm focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#FFE600]"
              />
            </label>

            {filteredBeats.length === 0 ? (
              <div className="border-2 border-dashed border-[#303846] p-4 text-center space-y-2">
                <p className="text-xs text-[#A3B1BC]">No beats match this filter.</p>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="cursor-pointer min-h-[44px] px-3 border-2 border-[#FFE600] text-[#FFE600] font-mono text-xs font-bold uppercase"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              <ul className="space-y-2">
                {filteredBeats.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setFrame(b.startFrame)}
                      aria-current={currentBeatIdx === b.index ? 'true' : undefined}
                      className="cursor-pointer w-full min-h-[44px] p-2.5 border-2 text-left transition-colors focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#FFE600]"
                      style={{
                        borderColor: currentBeatIdx === b.index ? '#FFE600' : '#232A35',
                        backgroundColor: currentBeatIdx === b.index ? '#1E242D' : '#0E1116',
                      }}
                    >
                      <div className="flex items-center justify-between font-mono text-[10px] text-[#A3B1BC]">
                        <span>
                          {b.code} · {b.speaker.toUpperCase()}
                        </span>
                        <span>f.{b.startFrame}</span>
                      </div>
                      <div className="text-xs font-bold text-[#F4F5F7] mt-0.5">
                        {b.importantMessage.headline}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
