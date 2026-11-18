# Uco & Ocu: Comic style (option)

One of the selectable video styles (Classic is in `video/STYLE.md`). Applies to the `EpisodeComic` composition,
the in-app preview when an episode uses the Comic style, and storyboard previews. Code: `video/src/comic/`.
Change it here first, then in code.

## 1. Canvas and technical format
- Vertical 9:16, 1080x1920, 30 fps. Frame-accurate `Sequence` timeline driven by a typed `SHOTS` array:
  `id`, `beat`, `speaker`, `startFrame`, `durationInFrames`, `layout`, `bannerText`, `dialogueId`, `dialogueEn`, `sfx`.
- Layer separation: character and scene layers carry no baked-in text. Comic banners, captions and SFX cues are
  separate Remotion overlay layers.
- Reduced motion: with `prefers-reduced-motion: reduce` (in-browser preview), turn off camera shake, Dutch-tilt
  oscillation and speed-line pulses. Shot cuts stay frame-accurate.

## 2. Visual language (2D hand-drawn comic)
- Linework: bold `3px solid #141619` ink outlines on every panel, prop and character silhouette.
- Shading: flat cel shading. No soft gradients, no glassmorphism blur, no neon glow.
- Depth: hard offset ink shadows (`4px 4px 0 #141619`) for panels and banners.
- Texture: subtle halftone dots on comic backdrops (`radial-gradient(#141619 1.5px, transparent 1.5px)`).
- Geometry: sharp 0px corners on panels, cards and banners. `border-radius: 9999px` only for corner cutaway
  cameo bubbles.

## 3. Palette (strict)
| Token | Hex | Use |
|---|---|---|
| Ink | `#141619` | outlines, hard shadows, dark text, dimmed inner-thought rooms |
| Uco golden orange | `#F5A623` | Uco's stage, energy bursts, sweater |
| Ocu slate teal | `#3A5859` | Ocu's stage, turtleneck, blazer tones |
| Bolt yellow | `#FFE600` | primary accent, zig-zag divider, active highlights, focus rings |
| Paper | `#F8F6F0` | banner fills, speech and thought bubbles, light surfaces |
| Muted slate | `#A3B1BC` | secondary labels, inactive timeline tracks |

## 4. Characters and shot choreography
Official character design: the UCO & OCU badge.

- **Uco (high energy, loud, triggered).** Messy copper-ginger hair, thick black rectangular glasses,
  mustard-orange sweater over a pale yellow collared shirt. Tight close-ups, -5deg Dutch tilt, pulsing yellow
  speed lines, cartoon sweat drops, an overhead anger thermometer that fills red and bursts white steam at peak
  frustration.
- **Ocu (deadpan, calm, unbothered).** Grey-blue skin, smooth dark swept-back quiff, thin rectangular glasses,
  half-lidded eyes, dark teal turtleneck under a grey-blue blazer. Steady upright framing, arms crossed or slow
  prop lifts, minimal mouth movement, a subtle knowing smirk, slow camera push-ins.
- **Split-screen debate.** Vertical 50/50: `#F5A623` left (Uco), `#3A5859` right (Ocu), split by a jagged
  `#FFE600` zig-zag divider with 3px ink borders. The non-speaking side is slightly dimmed.
- **Inner-thought beats.** Background switches to dimmed `#141619` with coloured rim light (`#F5A623` for Uco,
  `#3A5859` for Ocu), mouths closed, a white ink-bordered cloud thought bubble pops up.

## 5. Typography and overlays
- Comic banners and headlines: heavy uppercase geometric sans-serif, weight 900, tight tracking, in `#F8F6F0`
  or `#FFE600` boxes with a 3px `#141619` border and a `4px 4px 0 #141619` shadow.
- Monospace only for frame numbers (`f. 0000`), `MM:SS` timestamps and exported TypeScript.
