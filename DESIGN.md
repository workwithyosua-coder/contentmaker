# DESIGN.md: Dapur Konten

Direction for the **app** (the production tool). Source: the owner's answers on 2026-11-17 (name, mood, palette,
typography); concrete values below are the formatting of those answers.

> **The app is not the IP.** Dapur Konten produces IPs (Uco Ocu is the first). The app has its own name, icon and
> look. IP colors, characters and styles (Uco orange `#FF6B35`, Ocu teal `#2EC4B6`, comic style) appear **only
> inside IP content**: script bubbles, previews, thumbnails, rendered videos. Never in the app chrome.

## Identity

- **Name:** Dapur Konten ("content kitchen": the behind-the-scenes place where content gets made).
- **Personality:** a confident creative studio's own tool. Clear, a little bold, never noisy. The content it makes is
  the loudest thing on screen.
- **Dial:** ENERGY 2 / RHYTHM 2 / MOTION 2.

## Palette (2 core + 1 accent)

| Token | Light | Dark | Reason |
|---|---|---|---|
| Navy (core) | `#0E1A3A` ink, nav band | `#0B1530` background | Serious studio base, far from the IP colors |
| Paper (core) | `#F6F4EE` background, `#FFFFFF` surfaces | `#121E40` surfaces | Warm neutral so amber and content read clearly |
| Amber (accent) | `#F2A93B` fills only | `#F5B544` | The single signal: the main action and the active place in the app. Never used as text on light backgrounds (contrast) |

Data colors (platform dots, performance verdicts) encode information and are not part of the brand palette.

## Typography

- **Schibsted Grotesk** for everything. Reason: a clean grotesk designed for a media publisher (Schibsted), strong
  bold weights for confident headings, neutral and readable at small sizes for data tables and long scripts.
- Headings bold with tight leading; numbers tabular in data views.

## Shape and depth

- Radius hierarchy instead of pills: cards 14px, controls 10px, labels 6px.
- Borders over shadows; one shadow level reserved for elements floating above the page (bottom bar).

## Identity motif

- **Order tickets.** Episodes and ideas are shown as kitchen order tickets: a card with punched notches on its sides.
  Statuses read like ticket stamps (small, rectangular, bordered), not pills.
- The navy band (sidebar on desktop, bottom bar on phones) with the amber marker shows where you are.

## Motion

- Short transitions on hover, press and focus (150 ms) to make controls feel responsive.
- Loading placeholders pulse, and stop under "reduce motion".

## Interaction basics

- Every control shows a pointer cursor, distinct hover and pressed states, and a visible amber focus ring for keyboards.
- Phone tap targets at least 44px.
