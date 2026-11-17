# antislop audit 001: follow-up (2026-11-17)

Owner decisions applied: app renamed **Dapur Konten**, its own icon, and its own design direction (`DESIGN.md`),
kept separate from the Uco Ocu IP (IP colors appear only inside IP content).

Verification: production build, measured on an iPhone 14 viewport in light and dark mode plus a 1400px desktop:
Dashboard, Create, an episode script and Login. 0 console errors; no horizontal overflow; WCAG contrast computed
for every new color pair (all at least 4.5:1 for text, at least 3:1 for the focus ring).

## Fixed

| # | Rule | Fix and evidence |
|---|---|---|
| 1 | R-37 | `DESIGN.md` written from the owner's answers (mood, palette, typography, dials ENERGY 2 / RHYTHM 2 / MOTION 2). |
| 2 | R-23 | Name and icon chosen by the owner's direction: "Dapur Konten", navy/amber "dk" monogram (1024, 512, 192, maskable, Apple). |
| 3 | R-39 | Base styles give every control a pointer cursor and disabled controls `not-allowed`. Measured: buttons report `cursor: pointer`. |
| 4 | R-39 | Visible labels on the Create direction box, the script revision box and the login password field. |
| 5 | R-32 | One focus style everywhere: 2px ring (`#1F3D99` light, amber dark), contrast 8.7:1 and 9.9:1 against the page. |
| 6 | R-39 | Under "reduce motion", animations and transitions stop (global rule). |
| 7 | R-39 | Unique tab titles: "Dashboard · Dapur Konten", "Create · Dapur Konten", "Episode · Dapur Konten", "Sign in · Dapur Konten", legal pages. |
| 8 | R-39 | Buttons, chips and nav items have distinct hover, pressed and disabled states. |
| 9 | R-03 | Measured: 0 controls under 44px on Dashboard, Create and the episode screen (buttons, chips, nav, back link). |
| 10 | R-25 | Uco/Ocu labels on their bubbles now 5.4:1 and 5.5:1 in light mode. |
| 12 | R-02 | Installed-app name is now "Dapur Konten" (no em dash). |
| 13 | R-06 | Schibsted Grotesk, reason written in `DESIGN.md`. |
| 15 | R-11 | Radius hierarchy: cards 14px, controls 10px, labels 6px; no pill buttons or badges (avatars and data bars stay round on purpose). |
| 17 | R-29 | Brand palette is navy + paper + amber; platform and verdict colors kept as data encoding. |
| 20 | R-31 | Reasons recorded in `DESIGN.md`. |

Also: script section labels no longer use wide-tracked uppercase (R-06).

## Partly addressed

| # | Rule | Status |
|---|---|---|
| 16 | R-20 | Identity now comes from the navy band with the amber marker, the order-ticket motif for episodes and ideas, and ticket stamps for statuses. The Dashboard itself is still a fairly generic layout (see #19). |

## Still open (not yet approved)

| # | Rule | What's left |
|---|---|---|
| 11 | R-27 | Empty states for the weekly chart and a "connect accounts / publish your first episode" Dashboard state. |
| 14 | R-14 | The four "what's working" cards are still identical. |
| 18 | R-21 | No in-app light/dark toggle (follows the phone setting). |
| 19 | R-05 | Dashboard section rhythm is still a uniform stack of cards. |
