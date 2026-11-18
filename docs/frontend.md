# Frontend

`app/` is a Vite + React 19 + TypeScript single-page app with no router and no backend. It is MapLibre GL 5 for the basemap, deck.gl 9.4 (interleaved) for data layers, `h3-js` for cell geometry, and zustand for state.

## File map

| Path | Responsibility |
| --- | --- |
| `src/main.tsx` | Fonts (Geist, Geist Mono, Caveat), global CSS, React root |
| `src/App.tsx` | Layout: top bar, map stage, legend, cell card, panels, dialogs, tour, tooltip layer, toasts. Global Escape handling. |
| `src/data/types.ts` | Types of the data files (see [data-format.md](data-format.md)) |
| `src/data/metro.ts` | `buildMetro()` (typed arrays, projection, neighbour sums, place→cell), `placesNear()`, `cellLabel()` |
| `src/model/` | Factors, profiles, scoring, planner, exports. Pure; see [scoring-and-planning.md](scoring-and-planning.md) |
| `src/state/store.ts` | The app store: inputs, derived results, UI state, actions |
| `src/state/url.ts` | URL hash ⇄ plan state codec |
| `src/state/theme.ts` | Theme preference (system/light/dark) and resolved theme |
| `src/map/MapView.tsx` | Map, deck.gl layers, pin markers, camera behaviour |
| `src/map/basemap.ts` | MapLibre style over Overture PMTiles, plus per-theme palettes |
| `src/map/colors.ts` | Score → colour ramps (OKLab), evidence and ring colours per theme |
| `src/ui/TopBar.tsx` | Metro picker, release chip, Guide, theme toggle, data, link, export |
| `src/ui/BusinessPanel.tsx` | Profiles, five-step factor weights, homes floor |
| `src/ui/PlanPanel.tsx` | Pin count, radius, reach stats, ranked pin list |
| `src/ui/CellCard.tsx` | Verdict-first explanation of one cell, and its nearby places |
| `src/ui/Dialogs.tsx` | Export, About the data (ledger), Welcome |
| `src/ui/Select.tsx` | Themed, accessible listbox (replaces native `<select>`) |
| `src/ui/Tooltip.tsx` | App-wide tooltip driven by `data-tip` attributes |
| `src/ui/tour/` | Guided tour: steps, overlay, hand-drawn SVG generator |
| `src/ai/` | AI client (`client.ts`), AI store with undo (`store.ts`), the "Describe your business" box (`BriefBox.tsx`) |
| `src/ui/PinCard.tsx` | One pin's reach and its local ad angles (shares the cell card's slot) |
| `src/ui/ResultsDialog.tsx` | Learn from results (see [measurement.md](measurement.md)) |
| `src/ui/LiftTab.tsx` | Export ▸ Lift test, and its map overlay |
| `src/ui/CommandPalette.tsx`, `fuzzy.ts` | ⌘K palette and its matcher |
| `src/ui/motion.tsx` | `AnimatedNumber` (rolling stats) and `useFlip` (pin list reorders) |
| `src/ui/PrintPlan.tsx` | The client one-pager (print-only) |
| `src/ui/share.ts`, `src/map/snapshot.ts` | Share links with previews; map snapshots |
| `src/ui/edges.tsx` | Tab title, offline banner, error boundary |
| `src/state/history.ts` | Undo/redo snapshots, coalescing, change labels |
| `src/styles.css` | Design tokens (light and dark) and all component styles |

## State (`state/store.ts`)

One zustand store holds three kinds of state:

- **Plan inputs** (`PlanState`, mirrored in the URL): `metroId`, `profileId` (a preset id, or `custom` for AI-applied or hand-built weights), `weights`, `minHomes`, `pins`, `radiusMi`.
- **Derived results**: `metro` (a loaded `Metro`), `result` (`ScoreResult`), `plan` (`Plan`).
- **UI state**: `hovered`, `selected`, `focusedPin`, `dialog`, `view3d`, `tour`, `loading`, `error`, `frameRequest`.

Every input setter calls `recompute()`. It runs `scoreCells` and then `planPins` synchronously and writes the URL hash. There is no memoised selector graph: the whole recompute is cheap enough (< ~60 ms) to just redo.

Metro files are cached in memory after the first load, so switching back to a metro is instant.

### URL format (`state/url.ts`)

```
#/<metroId>?p=<profileId>&w=<factor>.<weight>,<factor>.<weight>…&n=<pins>&r=<radiusMi>&min=<minHomes>

#/chicago?p=pet-care&w=homes.1,pet_care.-1,pet_life.2,single.1&n=8&r=1.5&min=25
```

Only non-zero weights are written, sorted by factor id. Decoding validates every field: weights must be one of the five steps, `n` is clamped to 1–25, `r` to 1–50 and `min` to 0–500. A hand-edited or truncated link falls back to defaults instead of breaking. The hash is updated with `history.replaceState`, so tuning doesn't flood the back button.

### localStorage keys

| Key | Purpose |
| --- | --- |
| `catchment.theme` | `light` or `dark` (absent = follow the system) |
| `catchment.welcomed` | Welcome dialog seen |
| `catchment.toured` | Guided tour completed or skipped |

All access is wrapped in try/catch. With storage blocked, the app behaves like a first visit.

## Map (`map/MapView.tsx`)

**Basemap.** `basemapStyle(release, theme)` builds a MapLibre style whose sources are Overture's `base`, `transportation`, `buildings` and `divisions` PMTiles, read through the `pmtiles://` protocol. It draws land cover, parks, water, three road classes, extruded buildings, road labels and place labels (with Chicago's police beats filtered out). Glyphs come from Protomaps' public font assets.

**Layer order** (bottom to top):

1. Basemap fills and roads
2. `cells` (deck `H3HexagonLayer`), inserted **before** `buildings`, so buildings stand on the score
3. `pin-radius` (deck `ScatterplotLayer`, metres), also before `buildings`
4. `buildings` (MapLibre fill-extrusion; hidden in 3D)
5. Road and place labels
6. `evidence-links` and `evidence-places` (deck), from the hovered or selected cell to its nearby weighted places
7. `selected` cell outline (deck)
8. Pin markers (HTML elements, so they use the interface font and CSS animation)

**Pin markers.** Each marker is two elements. MapLibre owns the outer `.pin-anchor`: it is `position: absolute` and its `transform` is the pin's place on the map. Every animation and hover state lives on the inner `.pin` button. Never style the anchor's `position` or `transform`: that is how pins once drifted off their circles (a `position: relative` made them stack in page flow, and a transform transition made them trail the map while panning). Markers are keyed by cell, so a replan updates them in place: only new pins land, and pins that leave shrink out. MapLibre's own `role="button"` on the anchor is removed so the pin isn't a button inside a button.

**What the colours mean.** Few enough to read at a glance, each in both palettes (`colors.ts`):

| Colour | Meaning |
| --- | --- |
| Blue ramp | Above the median; darker is a better fit |
| Neutral wash | Below the median |
| Coral wash | Below the median *mainly because of something you avoid* (`heldBack()` in `model/score.ts`: an avoided factor is the biggest drag and the cell is clearly high on it). Hovering such a block says which signal. Shown only when something is avoided; never darker than a fit cell. |
| Cyan circle | A pin's reach; brighter when the pin is focused or hovered |
| Unshaded | Fewer homes than the floor, so not scored |

The legend entries are keys: hover or focus one to spotlight that kind of block (the rest dims in 160 ms), click to keep it on. Pin rows and markers light up together (`hotPin` in the store).

`beforeId` works at runtime in deck.gl's interleaved mode but isn't in the layer prop types, hence the `UNDER_BUILDINGS` spread.

**Camera.**
- The first framing of a session plays an establishing shot (pitch 64°, bearing −42°, zoomed in) that eases into the plan over 3.4 s.
- `frameRequest` (bumped on metro load and "Fit all") frames all pins.
- Focusing a pin fits its circle.
- Selecting a cell eases it to at least zoom 12.8 and into the clear space between the cell card and the plan panel, so the card never hides it.

**3D.** The cells are extruded by `homes × 2.6 m`, the camera pitches to 52°, and basemap buildings are hidden (the cells stand in for them).

**Motion.** Cell colours morph over 450 ms when scores change (160 ms for a legend spotlight) and pin radii over 320 ms. New pins land with a 45 ms stagger, a light overshoot and one cyan pulse. A focused pin pulses twice and then keeps a steady halo, because an endless pulse beside a map you're reading is a distraction.

## Motion vocabulary (`styles.css` tokens)

- `--ease-out` `cubic-bezier(0.23, 1, 0.32, 1)` for anything entering or responding. `--ease-in-out` `cubic-bezier(0.77, 0, 0.175, 1)` for things moving on screen (the tour spotlight, list reorders). `--ease-land` (a light overshoot) only for pins landing. `--ease-pen` for the tour's hand-drawn strokes.
- Durations: `--press` 140 ms, `--fast` 180 ms, `--base` 240 ms. UI motion stays under 300 ms. The only longer moves are the camera and the tour's drawing.
- **Content transitions** (`ui/motion.tsx`), one set of primitives used everywhere:
  - `useFlip(ref, deps, { enter })` glides rows to new positions and fades new ones up: the pin list, and the factor lists when a business type changes or a weight is zeroed. The disclosure and the homes floor carry flip keys too, so nothing below a list jumps.
  - `AutoHeight` eases a box to its content's new height: the export dialog between tabs, the brief box as examples collapse and suggestions arrive, and the results dialog between steps.
  - `Swap` fades in content that was swapped out, sliding 12 px from the side it came from when there's a direction (export tabs). It's used for the cell and pin cards when you move to another cell or pin, and for the business blurb. The first render never animates, and the direction is fixed per swap so a later re-render can't replay it.
  - `Indicator` (`useIndicator`) is one surface that slides between options: the segmented thumbs (radius, ZIP share, 2D/3D) and the export tabs' underline. The first placement and resizes jump; only selection changes slide.
  - Smaller touches: an example dropped into the brief washes the field blue for 700 ms, a reshuffled lift test re-deals its numbers, and counts (ZIPs to copy, test homes, held-out share) roll.
- **Frequency decides.** The ⌘K palette opens with no animation (it's used constantly, from the keyboard). After one tooltip has shown, the next appears without a fade. Exits are faster than entrances: modals sink out in 150 ms, toasts fade in 200 ms.
- **Press feedback is one gesture.** `scale(0.97)` on buttons, chips and cards; pins dip to 0.94. Hover transforms are gated to `(hover: hover) and (pointer: fine)`, so taps don't leave them stuck.
- Only `transform` and `opacity` animate. The "on target" bar is a `scaleX`, not a width.
- **Reduced motion means fewer, not none.** Entrance keyframes are redefined as plain fades, and travel, scaling and endless loops (pulses, the live dot, shimmer) stop. Colour changes stay, because they explain state. In JS, camera moves and deck transitions drop to 0 ms.

## Theming

- **CSS.** All colours are tokens on `:root` (`--ink`, `--paper`, `--card`, `--blue`, `--line`, `--solid`, `--glow`…). Dark values apply under `@media (prefers-color-scheme: dark)` with `:root:not([data-theme="light"])`, and under `:root[data-theme="dark"]`.
- **Choice.** `theme.ts` cycles system → light → dark and sets `data-theme` only for an explicit choice. An inline script in `index.html` applies a saved choice before first paint, so there's no flash.
- **WebGL can't read CSS variables.** The basemap has two palettes in `basemap.ts`. `applyBasemapTheme` swaps them with `setPaintProperty`, with no style reload, so tiles and deck layers survive. Score ramps, evidence colours and pin rings have two palettes in `colors.ts`.
- **One colour rule in both themes:** darker, more saturated blue means a better fit. Ramps interpolate in OKLab. In dark mode the pale end is also translucent, so weak cells recede.

Visual language is carried over from the Radar application site: Geist and Geist Mono, mono uppercase eyebrows, paper and ink, one electric blue, cyan for live signal, and verdict-first cards.

## Guided tour (`ui/tour/`)

- **`steps.ts`.** Six steps, each with a CSS `target` (spotlighted), an optional smaller `mark` to circle, a `side` for the note, a title, a body, and an optional `before()` that puts the app into the state the step describes. Step 4 selects the best cell. Step 5 closes it and re-frames the pins.
- **`Tour.tsx`.**
  - Measures the target after `before()` runs, and again at 80, 420 and 900 ms, because the card animates in and the map pans.
  - Places the note on the requested side, clamped to the viewport. On narrow screens it goes above or below, and the target is scrolled into view.
  - Draws an SVG layer: a dimmed backdrop with a mask hole around the target, plus the marks.
  - Keyboard: →/Enter for next, ← for back, Escape to close. Focus moves to Next on each step.
- **`sketch.ts`.** Pure, seeded generators for hand-drawn marks.
  - `arrow()` returns a curved shaft drawn twice (a pen going over a line) and a two-stroke head.
  - `scribble()` returns a loop that spirals slightly past its start.
  - `edgeToward()` stops arrows at the target's edge.
  - Marks are animated with `pathLength="1"` and a `stroke-dashoffset` keyframe, so one CSS rule "draws" any path.
- **When it shows.** On the first visit (even through a shared link) the welcome dialog shows, and closing it starts the tour. The Guide button in the top bar replays it.

## Tooltips (`ui/Tooltip.tsx`)

Add `data-tip="text"` to any element. One `TooltipLayer` delegates from `document`:

- It shows after the pointer rests for 800 ms, or after 250 ms when moving straight from another tooltip. Keyboard focus shows it at once. Touch never does.
- While visible, the element gets `aria-describedby="app-tooltip"`, and any previous value is restored afterwards.
- It sits above the element (below when there's no room), clamped to the viewport.
- Escape, scrolling and pressing hide it.

Components only declare text. There are no wrappers and no per-tooltip state.

## Select (`ui/Select.tsx`)

A themed replacement for `<select>`, used for the metro picker (top bar, `variant="plain"`) and the homes floor (`variant="field"`).

- **Pattern.** It follows the WAI-ARIA listbox pattern: the trigger is a button with `aria-haspopup="listbox"` and `aria-expanded`, and the menu is a focusable `role="listbox"` with `aria-activedescendant`.
- **Keyboard.** Arrows, Home/End, type-ahead, Enter/Space to choose, Escape to close (without also clearing the map selection), Tab to close and move on.
- **Placement.** The menu is portalled to `<body>` with fixed positioning, so the scrolling panel can't clip it. It opens upwards when there isn't room below.
- **Options** can carry a `detail` line.

## AI UI

See [ai.md](ai.md) for the server side.

- `useAi.checkHealth()` runs at boot. The brief box, the angles section and the AI tour step render only when it reports `ai: true`.
- **Brief box.** Example chips, a character counter, Ctrl/⌘+Enter to submit, a Cancel button (aborts the fetch), shimmer loading, and a proposal card with Apply and Discard. Apply calls `store.setWeights(weights, "custom")` and keeps the previous weights for **Undo**. While a factor's weight is still the one the model suggested, its row shows the model's reason in place of the static description.
- **Pin card.** It opens when a pin is focused (from the list or its marker). It shows the pin's homes, on-target share, fit and rank, then **Write 3 angles**. Results show the angle type, headline, body, verified place chips (✓, with the GERS ID in a tooltip), Copy, Regenerate, and a footer with the grounding count, rejected drafts and cost. Angles are stored per pin + radius + weights.
- Every AI result shows its provenance: model, seconds, cost, and "schema-checked" or "grounded in N places".

## Power-user layer

- **⌘K / Ctrl+K** opens the command palette: actions, metros, business types, pins, radius and pin count. It's an ARIA combobox and listbox; the fuzzy matcher favours word starts ("lp" → Lincoln Park). The top bar has a "Search ⌘K" button.
- **Undo and redo** (⌘Z, ⇧⌘Z or Ctrl+Y) cover every plan change, including AI and calibration applies.
  - History stores `PlanState` snapshots (the URL's inputs), so each step is a reproducible plan.
  - Same-kind changes within 600 ms coalesce, and undo crosses metro switches.
  - A toast names what changed.
  - The shortcuts are ignored while typing in a text field.
- **Single-key shortcuts** (`ui/shortcuts.ts`): `A` Autopilot, `E` export, `F` fit all pins, `3` 2D/3D, `[` and `]` previous and next pin. They're ignored while typing, with a modifier held, or with a dialog, the palette or the tour open. One table feeds the key handler, the palette's keycaps and the tooltips (`data-keys`), so what the UI teaches is what the keys do.
- **Motion that explains change.** Stats roll to new values with tabular figures, and the pin list animates reorders (FLIP, keyed by cell). A polite live region announces "Plan updated: N pins, X homes, Y% on target" after edits settle.

## Hand-offs

- **Client one-pager.** ⌘P, the palette, or Export ▸ Files prints a document built from live state: the stats, the real map (snapshotted as printing starts; the map keeps `preserveDrawingBuffer`), the pin table, the reasoning, the lift test, the ZIPs and the caveats. Print CSS forces the light tokens.
- **Link previews.** With the server, "Copy link" makes `/s?h=…&t=…&d=…&img=…`. The server answers with Open Graph tags and an instant redirect into the app; `img` is a 1200×630 snapshot uploaded to `/api/previews`. Without a server it copies the plain URL.
- **Pin card.** It shows reach, then *Since <release>* (changes read through the weights: new listings of avoided signals and closures of preferred ones are alerts), local ad angles with video scene prompts, and **Copy brief / Brief .md**, a grounded creative brief (`model/brief.ts`).

## Loading states (`ui/Progress.tsx`)

One rule: **measure what can be measured; never fake what can't.**

- **Loading a metro** streams the file and reports real bytes against the uncompressed size recorded in `index.json` (`Content-Length` would be the gzipped size). The store's `loadProgress` goes 0 → 1, then `"build"` while typed arrays and neighbour sums are made (one frame is yielded first, so that state paints). It shows as a 2 px bar under the top bar and a percentage beside the metro name. The bar appears only after 150 ms, so a cached switch never flashes. While it loads, the map, panels and legend step back to 55% opacity (the numbers are stale), and the app is `aria-busy`. A request ticket stops a slow earlier load from overwriting a newer one. The first load shows the same progress in a centred card ("1.2 of 2.4 MB", then "Building 11,758 blocks…").
- **AI calls** can't report progress, so `StagedProgress` shows the stages the server really runs, the real elapsed seconds, and a skeleton shaped like the answer (weight rows for a brief, three cards for angles). Stages advance on an estimate, but the last never completes by timer: it stays active until the reply lands. Past 1.6× the estimate it says "taking longer than usual". Screen readers hear each stage once. While a brief is read, a light passes along the field and the ✦ twinkles. Cancel stays available.
- **Copy link** answers on the button itself: "Copying…" while the map snapshot uploads, then "Copied" with a drawn check for 1.8 s. The three labels share one grid cell, so the width never changes. Only a failure raises a toast.
- Under reduced motion, sweeps, shimmer and pulses stop; progress values and stage changes still show.

## Autopilot and videos

- **`autopilot/store.ts`** runs the steps through the app's own actions (`setWeights` via the AI store's apply, `setPins`, the model functions), so the map updates as each step lands and every change is in undo history. `before` snapshots the plan, and **Undo Autopilot** restores it as one step (`applyPlan`). A run ticket makes Stop and reruns safe. If the dialog is closed mid-run, `AutopilotPill` in the top bar shows progress and reopens it.
- **`autopilot/AutopilotPanel.tsx`** has three views: ask (brief and budget), run (real steps with real details), and kit (a video, script and budget per pin, and downloads).
- **`video/stills.ts`** photographs each pin with a hidden second MapLibre map: 720×1280, pixel ratio 1, always the light palette, so a film doesn't depend on the viewer's theme. It projects the pin's scored blocks and the script's places while that map is framed, so they line up exactly.
- **`video/film.ts`** is `drawFrame(ctx, t, spec)`, a pure function of time. Over 8 s:
  - the map settles from a slow push-in;
  - blocks colour in from the centre;
  - a hand-drawn ring circles the reach;
  - arrows and handwritten labels point at up to three real places, in non-overlapping slots, with ellipses rather than squashed text;
  - a close card (business, area, homes in reach, a call to action) slides up.

  The title card is readable by 0.6 s. Strokes use seeded randomness, and the attribution is on every frame.
- **`video/FilmPlayer.tsx`** previews by drawing frames live: no file needed, and only the playing film animates. **`video/encode.ts`** encodes the same frames with WebCodecs through Mediabunny, faster than real time: MP4 and H.264, or WebM and VP9 where the browser can't encode H.264. Mediabunny is loaded only on download.

## Edge states

- The tab title names the plan.
- Going offline shows a banner saying what still works.
- An error boundary replaces a blank page with "Reload the plan" (nothing is lost; the plan is in the URL) and "Copy error details".

## Accessibility checklist (what's in place)

- Every control is a native button, or follows an ARIA pattern (radiogroups for weights, radius and view; listbox for selects; dialog for modals and tour notes).
- Visible focus ring (`:focus-visible`, 2 px blue).
- Text alternatives: pin markers have aria-labels with their neighbourhood, and tooltips are announced via `aria-describedby`.
- Reduced motion is respected everywhere.
- Contrast: text meets WCAG AA (4.5:1) in both themes. `--muted` is `#63666d`, and blue *text* uses `--blue-text` (`#8a92ff` in dark) while fills keep `--blue`. Enforced by the axe audit in `e2e/` (light and dark).
- Escape closes, in order: menus, tour, cell card, focused pin.

## Adding things

- **A UI explanation.** Add `data-tip` to the element. No code changes.
- **A tour step.** Append to `STEPS` with a selector that exists when the step runs. Use `before()` to create that state.
- **A profile.** Add an entry to `PROFILES` in `model/profiles.ts`. It appears automatically, and the URL key is its `id`.
- **A map layer.** Add it in `MapView`'s layer effect. If it should sit under buildings, spread `UNDER_BUILDINGS`, and add its colours to both palettes in `colors.ts`.
