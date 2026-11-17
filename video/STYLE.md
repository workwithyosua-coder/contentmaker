# Uco & Ocu: visual style bible

The animation code in `video/src` follows this. Change it here first, then in code.

## Aesthetic and linework
- Expressive 2D hand-drawn comic cartoon: modern editorial webcomic meets PNG-tuber / limited-animation rig.
- Bold, slightly irregular black ink outlines (`#0E0E12`) with Ben-Day / halftone dot shading.
- Jagged lightning-yellow (`#FFD60A`) zig-zag dividers, speed lines and impact bursts to split panels and land punchlines.

## Colors (high-contrast split)
| Role | Color |
|---|---|
| Canvas | charcoal `#1E1E24` |
| Uco (left, warm) | burnt orange `#E85D04`, amber `#F48C06` |
| Ocu (right, cool) | slate blue `#3A5A78`, deep teal `#2A6F7B` |
| Highlights, text popups | lightning yellow `#FFD60A`, off-white `#F8F9FA`, heavy black drop shadows |

## Characters
- **Uco, the volatile idealist.** Young Indonesian man in his 20s. Wild spiky dark hair, oversized angular rectangular glasses,
  wide frantic eyes, gaping yelling mouth, sweat drops, red anger vein and thermometer. Upright, leaning forward. Orange shirt.
- **Ocu, the unbothered catastrophist.** Young Indonesian man in his 20s. Messy flat relaxed hair, massive round glasses,
  heavy half-lidded eyes, flat knowing smirk, stubble. Slouched, hands tucked or loosely holding a drink. Grey tee.

## Animation and timing
- Limited animation: 8 expression swaps per character (deadpan, calm, worried, angry, furious, excited, thinking, smug),
  squash-and-stretch entrance pops, idle breathing, hard smash cuts, ink lines that re-jitter every 3 frames.
- Uco moves fast: overshoot/bounce entrances, white flash and screen shake on hot lines.
- Ocu moves slow: linear ease in/out, slow push-ins, long deadpan holds.
- Gags synced to dialogue: floating 2D prop icons picked from each line's `visual` notes (see `src/Props.tsx`),
  newspaper cutouts, anger thermometer, thought clouds in a dimmed room for inner monologues, kinetic comic caption cards.
- Vertical 1080x1920. Characters and text stay inside the center 80% safe zone.
