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

`beforeId` works at runtime in deck.gl's interleaved mode but isn't in the layer prop types, hence the `UNDER_BUILDINGS` spread.

**Camera.**
- The first framing of a session plays an establishing shot (pitch 64°, bearing −42°, zoomed in) that eases into the plan over 3.4 s.
- `frameRequest` (bumped on metro load and "Fit all") frames all pins.
- Focusing a pin fits its circle.
- Selecting a cell eases it to at least zoom 12.8 and into the clear space between the cell card and the plan panel, so the card never hides it.

**3D.** The cells are extruded by `homes × 2.6 m`, the camera pitches to 52°, and basemap buildings are hidden (the cells stand in for them).

**Motion.** Cell colours transition over 450 ms and pin radii over 500 ms. Pins new to the plan drop in with a staggered delay and one cyan pulse, and the focused pin keeps pulsing. Under `prefers-reduced-motion` all durations are 0 and CSS animations are disabled.

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

## Accessibility checklist (what's in place)

- Every control is a native button, or follows an ARIA pattern (radiogroups for weights, radius and view; listbox for selects; dialog for modals and tour notes).
- Visible focus ring (`:focus-visible`, 2 px blue).
- Text alternatives: pin markers have aria-labels with their neighbourhood, and tooltips are announced via `aria-describedby`.
- Reduced motion is respected everywhere.
- Escape closes, in order: menus, tour, cell card, focused pin.

## Adding things

- **A UI explanation.** Add `data-tip` to the element. No code changes.
- **A tour step.** Append to `STEPS` with a selector that exists when the step runs. Use `before()` to create that state.
- **A profile.** Add an entry to `PROFILES` in `model/profiles.ts`. It appears automatically, and the URL key is its `id`.
- **A map layer.** Add it in `MapView`'s layer effect. If it should sit under buildings, spread `UNDER_BUILDINGS`, and add its colours to both palettes in `colors.ts`.
