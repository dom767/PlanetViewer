# Baffled Cat — Style Guide

Design conventions used across `index.html` and the rest of the site. Source of truth is `styles.css` (the `:root` custom properties); this doc explains the intent behind those values so new pages/components stay consistent.

## Colour

Dark theme only (`color-scheme: dark`).

| Role | Variable | Value | Usage |
|---|---|---|---|
| Background | `--bg` | `#1c1812` | Page background (warm near-black brown, not pure black) |
| Raised surface | `--bg-raised` | `#262019` | Cards, panels |
| Raised surface (hover) | `--bg-raised-hover` | `#2e271e` | Hover state for raised surfaces |
| Primary text | `--text` | `#f6efe2` | Headings, body copy (warm off-white, not pure white) |
| Muted text | `--text-muted` | `#b3a68e` | Secondary copy, descriptions |
| Faint text | `--text-faint` | `#85795f` | Footer, eyebrows, least-emphasis text |
| **Primary accent** | `--accent-amber` | `#f2a544` | Primary highlight colour — CTAs, links on hover, active nav underline, focus outline, text selection |
| Primary accent (soft) | `--accent-amber-soft` | `rgba(242,165,68,0.14)` | Tinted backgrounds/badges using the primary accent |
| **Secondary accent** | `--accent-teal` | `#6fb8ae` | Secondary highlight — default link colour inside body copy, secondary tags |
| Secondary accent (soft) | `--accent-teal-soft` | `rgba(111,184,174,0.14)` | Tinted backgrounds/badges using the secondary accent |
| Border | `--border` | `rgba(246,239,226,0.1)` | Default hairline borders |
| Border (strong) | `--border-strong` | `rgba(246,239,226,0.2)` | Emphasised borders (e.g. ghost button, card hover) |

**Pattern:** amber is the "do this" colour (buttons, active states, hover-highlight); teal is the "secondary/informational" colour (inline links, secondary tags). They're rarely mixed on the same element — pick one accent per component.

Background also carries two very low-opacity radial gradients (amber top-left, teal top-right) behind the flat `--bg` colour, giving subtle warmth without a visible gradient edge.

## Typography

Four font families, each with a distinct job — don't substitute one for another:

| Variable | Stack | Used for |
|---|---|---|
| `--font-brand` | Fredoka | Logo/wordmark only ("Baffled Cat") |
| `--font-display` | Space Grotesk → Inter | Headings (h1–h3), nav links, buttons, project links — anything that should feel like UI/branding |
| `--font-body` | Inter → system-ui | Paragraph copy, general body text |
| `--font-mono` | JetBrains Mono → ui-monospace | Eyebrows/labels, footer, tags — small uppercase metadata-style text |

Headings use tight tracking (`letter-spacing: -0.01em` to `-0.02em`). Sizes are `clamp()`-based for fluid responsiveness rather than fixed breakpoints.

## Capitalisation

- **Headings (h1/h2/h3):** Sentence case, conversational tone — e.g. *"Things we've built"*, *"A small studio, mildly confused"*. Not title case.
- **Eyebrows / labels / tags** (`.eyebrow`, `.project-tag`): ALL CAPS via `text-transform: uppercase`, set in mono font with wide letter-spacing (`0.06–0.08em`). Used for short metadata like "PROJECTS" or "LIVE · ANDROID".
- **Nav links, buttons, body copy:** Normal sentence/title case as written, no forced transform.
- **Project tags** combine a status and platform separated by a middle dot, e.g. `Live · Android`, `Live · Web`.

## Highlight / accent usage

- `--accent-amber` = primary highlight: hover states, active nav-link underline, `:focus-visible` outline, `::selection` background, primary buttons, eyebrow dot marker.
- `--accent-teal` = secondary highlight: default colour for inline text links, secondary badges/tags.
- Hover convention: muted/faint text brightens to `--text` or transitions straight to `--accent-amber` — never introduces a new colour.

## Shape

- `--radius`: 14px — cards, page panels.
- `--radius-sm`: 9px — smaller elements.
- Buttons and tags use fully-rounded pill shapes (`border-radius: 999px`).

## Animation

- **Transitions** (hover/interaction feedback): short and linear-ish, `0.15s ease`, on `color`, `border-color`, `background`, `opacity`, `transform`. Card hovers lift slightly (`translateY(-4px)` or `-1px` for buttons) rather than scaling.
- **Intro splash** (homepage only, plays once per tab session — see `index.html`): a choreographed, multi-stage reveal — white background dissolving to `--bg`, cat image and wordmark fading/translating up, individual letters "popping" in sequence with staggered delays, finished with a blur-out + fade-out handoff into the page. This is bespoke and should stay unique to the homepage entrance; don't reuse the letter-pop treatment for routine UI.
- **`prefers-reduced-motion: reduce`** is always respected: all animations/transitions collapse to near-instant (`0.01ms`) globally, and the intro splash specifically zeroes its animation delays.

## Layout

- Content max-width: `1080px` for full-width sections (nav, project grid, footer); `780px` for prose-heavy sub-pages (`.page-shell`, about/privacy style pages).
- Horizontal padding uses `clamp(1.25rem, 4vw, 2rem)` throughout for consistent fluid gutters.
