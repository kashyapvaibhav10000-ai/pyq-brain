# PYQ Brain design system: paper & pen

Visual language adapted from [Looseleaf](https://kevintngo.github.io/looseleaf/) (MIT), "shadcn/ui, drawn by hand",
and rebuilt for this stack: server-rendered HTML, one CSS file, **no JavaScript**, works offline.

Live specimen of every component and state: **`/design`** (logged in). Source of truth: `public/app.css`.

## Principles

1. **A real notebook on a tidy desk.** Sage desk, cream paper sheet, slips (cards, fields) lying on it. Warm umber shadows, never gray.
2. **One tool, one job.** Every color means one thing (table below). Never use a color for a second meaning.
3. **The interface is calm; the charm is decoration.** Hand-drawn outlines, washi tape and highlighter swipes decorate. The layout, text and controls behave like a plain, professional app.
4. **States change the drawing, not only the hue.** Hover lifts, press sinks 1px, focus is a blue ring, disabled is pencil + hatch, invalid is red pencil, danger is red + hatch + a word. Nothing depends on seeing a color.
5. **Long lists are notebook lines, not boxes.** Rows get blue rules and a highlighter on hover/open. Only controls and sheets get outlines.
6. **Big sheets lie flat; small sheets turn.** The page sheet has no tilt (it is tall; tilt would drift its edges). The small login sheet turns −0.6°. Only the sheet layer turns, never the text.
7. **Everything is a token.** Colors, sizes, spacing, shadows, durations. A theme (dark) is a block of token overrides; no component is edited for it.
8. **Same seed, same line.** Outlines come from a seeded generator, so screenshots are stable.

## Color: one tool, one job

| Token | Light | Job |
|---|---|---|
| `--desk` | `#a8c8bb` | page background |
| `--paper` | `#f8f5ee` | the sheet content sits on |
| `--slip` | `#fbf8f1` | fields, buttons, cards on the sheet |
| `--ink` | `#2a2420` | text, headings, control outlines |
| `--you` | `#2c4f9e` | links, typed text, focus ring (blue felt = you) |
| `--pencil` | `#5a554e` | meta: hints, captions, counts |
| `--marker` | `#df6b3c` | the one main action on a screen (`button.primary`) |
| `--hi` | `#f8dc4c` | current / selected / emphasis (highlighter) |
| `--red` | `#c2412d` | errors, danger; always with a word |
| `--green` | `#3b7a4b` | done, saved |
| `--sticky-*` | pastels | decoration only (marks badges, sticky notes); text on them is always `--ink` |
| `--rule-blue` | `#8fb0d4` | notebook rules between list rows |

Components use **role tokens** (`--bg --surface --raised --text --meta --link --focus --primary --select --danger --ok`), never raw hex.
Text on marker/highlighter/red uses `--on-marker`, `--on-select`, `--on-red` (dark in both themes).

**Contrast:** every text pair is AA (≥ 4.5:1) in light and dark. `test/design.test.ts` checks this, so a palette change that breaks contrast fails the tests.

## Type

- **Kevin Sans** (MIT, `public/fonts/`, license in `public/fonts/LICENSE.txt`). One hand for everything.
- `--font` = "Kevin Sans Hand": the same font at 88% (`size-adjust`), for interface text and body. `--font-title` = full size, for headings.
- Scale: `--fs-xs .8rem`, `--fs-sm .88rem`, `--fs-md 17px` (body), `--fs-h3`, `--fs-h2`, `--fs-h1`. Line height 1.55.
- `text-rendering: geometricPrecision` on body. Without it Android Chrome snaps glyphs to whole pixels and splits words ("Pharm acology").
- h1 = highlighter swipe behind; h2 = pencil rule under; bold (`<b>`) for drug names in answers.

## Space, shape, elevation, motion

- Space: `--s1 .25rem` … `--s6 2rem` (4px steps). Targets: `--hit 40px` for buttons/fields, chips 36px.
- `--radius 6px` (clips fills inside drawn corners). `--pen 2px` real border (fallback).
- Shadows: `--shadow-hair | card | paper | lift | sticky`, umber `rgb(var(--shade))` × `--shadow-k` (dark sets 2.2).
- Motion: `--dur-press 80ms`, `--dur-hover 140ms`, `--dur-open 220ms`, all × `--motion`. Reduced motion sets `--motion: 0` and removes all animation.

## Hand-drawn outlines (how)

`scripts/ink.mjs` draws a wobbly rounded rectangle (lean at the corners, overlapping pen lift) per **pen × seed** into a 48×48 SVG and writes them as tokens `--ink-{pen}-{a|b|c}` into the `INK` block at the end of `app.css`. Elements use it as a 9-slice `border-image`, so corners keep their drawn shape and edges stretch to any size.

- Pens: `ink` (controls), `pencil` (quiet: fields at rest, chips, ghost, badges, disabled), `red` (danger, invalid). Light + dark colors.
- Seeds `a b c` rotate by `:nth-child`, so neighbours never look stamped.
- A component picks its pen by setting `--pa/--pb/--pc`. To add a drawn element, add it to the `:where(...)` list in §6.1 or give it class `drawn`.
- `forced-colors` drops the drawing and shows the real border.
- After changing pens or seeds: `node scripts/ink.mjs`.

## Components (all in `public/app.css` §6)

| Component | Markup | Notes |
|---|---|---|
| Button | `<button>` | outline on slip. `.primary` marker (one per screen), `.secondary` highlighter, `.ghost` pencil, `.danger` red + hatch, `.link` text. `disabled` = pencil + hatch |
| Field | `input select textarea` | pencil at rest, ink + blue ring on focus, red when `:user-invalid`; typed text blue |
| File picker | `input[type=file]` | highlighter button |
| Chip | `.tabs a`, `.filters a`, `.filters label` (+ hidden radio) | pencil; current/checked = highlighter + ink |
| Filters | `Filters` (views.tsx) | radio chips + generated CSS (`:has()`), no JS, works offline |
| Badge | `.badge[data-m]` | pencil pill; marks get a sticky color (2 blue, 5 green, 7 orange, 10 pink) |
| Card | `.card` | slip, no outline, umber shadow |
| Collapsible | `details.cov`, `details.fold` | unit coverage, uploaded papers |
| Ruled list | `section > details.qi` | blue rules, chevron, highlighter when open; answer in `.ab` slip |
| Correction | `.answer .fix` | red-pencil rule + tint: a fact-checked fix to the notes (`✎` line) |
| Textbook block | `.answer .ext` + `.exthead` | blue-felt rule + tint: answer written from a textbook, not the notes (`⚑` line) |
| Samjhao | `details.sj` slip; `.yaad` yellow sticky (`💡` line), `.eg` blue sticky (`🏠` line) | simple Hinglish explanation above the answer; "Suno" ghost button reads it aloud |
| Notes | `.warn` sticky, `.okbox` ✓, `p.err` ✗ + red | messages always worded |
| Table | `table` | blue-felt heads, ink rule, pencil hairlines, `.share` highlighter bar |
| Empty | `.empty` | dashed pencil box |
| Loading | `.htmx-indicator` | soaks in and out (none with reduced motion); buttons disabled + hatched while busy |
| Shell | `Layout` | `.topbar` paper strip (current page highlighted, `aria-current`), `main` sheet + washi tape |

## Accessibility checklist (per component)

- Real elements only (button, input, details/summary, radio). The drawing is a CSS border, never focusable, never content.
- Visible focus everywhere: `:focus-visible` blue ring, offset 3px. Radio groups = one Tab stop, arrows move.
- Contrast AA (tested). Meaning never by color alone.
- Targets ≥ 36px; fields 16px+ text (no iOS zoom).
- `prefers-reduced-motion`, `forced-colors`, and print are handled in §7.

## Don'ts

- No raw hex in components. No new colors without a job.
- No outline boxes around list rows or long text.
- No stickers or tape on content; decoration stays at the edges.
- No tilt on tall sheets; no tilt on text.
- No JS for visuals.
