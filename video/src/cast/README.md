# Uco & Ocu puppet sprites and sound effects

Optional assets for the Koran Kinetik and Diagram Taktis styles. Drop files into the repo root `public/` folders
(directly on GitHub is fine). `npm run build` (Vercel, via `prebuild`) and every render refresh
`video/src/assets/assetManifest.json`. Anything missing falls back: the coded SVG character, or no sound.

## Sprites: `public/cast/{uco|ocu}/{emotion}-{closed|open}.png`

Each emotion needs **both** mouth frames (`-closed` and `-open`), or that emotion uses the SVG.

- **Size:** 900 × 1700 px PNG, transparent background (RGBA). This is the 180 × 340 figure frame × 5.
- **Framing** (same as the SVG figures, in px on the 900 × 1700 canvas):
  - **Horizontal:** the face centred on x = 450.
  - **Hair top:** at y ≈ 40.
  - **Eyes / glasses:** at y ≈ 290–370.
  - **Mouth:** at y ≈ 420–470.
  - **Chin:** at y ≈ 520.
  - **Shoulders:** start at y ≈ 560.
  - **Torso:** runs to the bottom edge (cut flat at y = 1700).
  - **Body width:** shoulders span about x 110–790. Leave the rest transparent; nothing may touch the left or right edge except the Ocu CTA arm.
- **Anchor:** top-centre. The figure is scaled uniformly to fit the frame and aligned to the top.
  - The character's head must stay in the top 31% of the canvas (y < 520), so faces stay above TikTok's caption area at every shot size.
- **Closed vs open:** the two frames must be identical except the mouth, and the eyes may also differ, so the swap doesn't jump.
- **Style:**
  - Koran Kinetik: a paper cut-out look (thick ink line, flat colour). The app adds no outline of its own to sprites.
  - Diagram Taktis: the same sprites with its own rim light added by the app.

| File | Pose |
|---|---|
| `uco/triumphant-*.png` | fist up / pointing, big grin (default loud Uco, also his CTA pose) |
| `uco/defensive-*.png` | arms crossed, squinting |
| `uco/shocked-*.png` | wide eyes, hands up (the app adds sweat drops) |
| `uco/phone-*.png` | holding a glowing phone at chest height, right side |
| `uco/explaining-*.png`, `uco/deadpan-*.png` | optional |
| `ocu/deadpan-*.png` | default: calm, half-lidded |
| `ocu/explaining-*.png` | one hand open, explaining |
| `ocu/inspecting-*.png` | magnifying glass held up, left side |
| `ocu/shocked-*.png`, `ocu/defensive-*.png` | optional |
| `ocu/cta-*.png` | **CTA pose:** right arm raised beside the head, index finger pointing right; fingertip at **(870, 235)** exactly |

### Artwork with its own framing

You don't have to hit the framing above exactly. Measure where the head is on the exported PNG and add it to
`video/src/cast/spriteCalibration.ts` (`hairTop`, `chin`, `faceX` in px). The puppet then scales and shifts the image
so the head lands on the director's head position. If the body ends above the bottom of the frame, its last rows are
continued straight down.

Uploaded so far (closed and open frames share one crop):
- `uco/triumphant`: hair top 150, chin 720, face x 410
- `ocu/deadpan`: hair top 150, chin 720, face x 493

Both characters share one head size, and both sit flush at y 1700. Uco's sweater was extended straight down from its
flat cut.

Each character's first uploaded emotion stands in for emotions that haven't been drawn yet: Uco uses `triumphant`,
Ocu uses `deadpan`. So the same person never switches between the illustrated and the coded look within a video.

## Sound effects: `public/sfx/`

| File | When | Length |
|---|---|---|
| `whoosh.mp3` | every cut to a different camera shot | ≤ 0.6 s |
| `pop.mp3` | a solo shot's topic prop springs in | ≤ 0.4 s |
| `stamp.mp3` | Koran Kinetik stamp slam (34 frames into a beat) | ≤ 0.5 s |

Use mono or stereo MP3 (or WAV) at 44.1 or 48 kHz, peaks around −3 dBFS, with no silence at the start (the effect plays on the exact frame).
