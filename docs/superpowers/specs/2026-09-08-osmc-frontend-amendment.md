# Amendment: back onto OSMC's frontend infrastructure

*2026-09-08. Amends `2026-09-07-phasegrid2-architecture-design.md`, which specified "replacing
Tailwind with CSS Modules + CSS custom properties" and a `check-no-tailwind` lint gate. That decision
is reversed. The rest of that spec stands.*

## Why

The original instruction was not to use Tailwind, and it was followed: eighteen `.module.css` files
and a hand-rolled four-step spacing scale. The cost was not the utility classes. It was everything
OSMC's Tailwind-based components carried with them, which did not come across and was not rebuilt:

- **The dock was decorative.** `Dock.tsx` rendered hardcoded children. No widget registry, no
  per-slot tab strip, no way to close, add or move a panel, and no way to say in a settings file
  where you wanted them. The columns dragged; nothing else about the layout was real.
- **Spacing and type were wrong.** Four spacing steps, four font sizes, and the application asking
  for Source Code Pro while shipping no font file — so every window fell back to the platform's
  monospace.
- **No minimap.** OSMC's `MinimapDrawer` registry, where each drawn thing paints itself as coloured
  pixels into a shared buffer under a draggable viewport rectangle, was absent.
- **No Set Theme.** A `<select>` in the status bar rather than a picker that previews as you move
  through it.
- **No schema system.** `schemas/core/schema.ts` and both form layers did not exist, so the
  inspector was a placeholder paragraph.
- **No settings editor.** A `<textarea>` showing `{}`, with no completion, no descriptions and no
  way to tell a misspelled key from an unset one.
- **The canvas navigated badly.** Correct transform arithmetic, but the only pan was a middle-button
  drag — which most laptops cannot make — and the wheel was a coarse two-step zoom, so a two-finger
  scroll lurched the patch towards and away from you instead of moving it.

## Decisions

| Question | Decision | Reason |
| --- | --- | --- |
| Styling | Tailwind v4; all CSS Modules removed | The components being copied are written in it, and porting each one's styling was the step that kept being paid for and never finished |
| Theme source of truth | Duplicated: `css/theme.css` and `theming/themes/*.ts`, with a parity test | CSS needs the values for Tailwind's `@theme`; the Pixi canvas cannot read a stylesheet. The test is the mitigation for the drift the original spec avoided by having one copy |
| Dock persistence | Split: geometry in `userData`, widget→slot in `workspace.json` | Column widths are about the display; which panel is where is about how you work, and a workspace should carry it |
| Minimap coordinates | Buffer sized from the patch's own extent | OSMC's world is a bounded grid; a patch is an unbounded plane, so the buffer is a window and drawers are given an origin offset |
| Centre slot | One pinned `grid` widget hosting the project tabs | The dock's tabs and the document's tabs answer different questions; collapsing them would make closing a project and closing a panel the same gesture |
| Tool modes | Not copied | OSMC's canvas is modal because it is a map. Every gesture here is direct, so nothing needs arming |

## What was copied, changed, and left

**Copied close to verbatim:** `schemas/core/`, `components/schema-form/`, `components/form/`,
`components/tabs/`, `components/dropdown-menu/`, `components/form-controls/`, the buttons, the
activity indicator, the resize handles, the tree navigator, the widget/status-bar/control-bar
registry shape, and the minimap's static/dynamic layering.

**Changed on the way:**

- The modal stays on the platform's `<dialog>` rather than adopting OSMC's headless UI dependency —
  `showModal` already gives a real focus trap, the top layer and an inert background.
- The command palette keeps phasegrid's subsequence ranking, which puts "Add Module" first when you
  type `adm` where OSMC's substring filter finds nothing.
- `WidgetDefinition` gains `scope`, applied as `data-kb-scope`, so phasegrid's scoped keybindings
  keep working through the new chrome.
- The theme store no longer touches the document; `watchTheme` does, matching `watchEngine`.
- Wheel handling is deliberately *not* OSMC's. OSMC zooms on scroll because it is a game; here a
  two-finger scroll pans and a pinch zooms, which is what a node editor does and what fixes the
  actual complaint.
- Monaco is imported narrowly (`editor/editor.api` plus the JSON service, two workers) and loaded
  behind a dynamic import. OSMC's barrel import and five workers were 7.7 MB and ninety tokenizer
  chunks for a window that only opens JSON — and its TypeScript worker needs `eval`, which this
  renderer's content policy forbids.
- Hardcoded `blue-500` / `green-500` / `red-500` in the copied components became theme tokens.
- `patchBounds` lives in `grid/`, not in the minimap: the rectangle a patch occupies is a fact about
  a patch, and zoom-to-fit needs it too.
- Minimap drawers write into a structural buffer rather than an `ImageData`, so they are tested
  without a DOM.

**Left behind, deliberately:** OSMC's `data-grid/` (thirty-odd files), `charts/`,
`floating/toast/`, `router/`, `services/storage/`, `demos/` and `tools/`. None has a consumer here.

## Consequences

- `docs/design-system.md`, as described in the original spec, does not apply: the tokens are
  Tailwind's plus `css/theme.css`. `docs/ui.md` replaces it.
- `scripts/check-no-tailwind.mjs` is not written and would now be wrong.
- Adding a colour costs four edits and is guarded by `theming/theme-parity.test.ts`. That is the
  price of the duplication and it was accepted with the trade understood.
- `layout.widgets`, `layout.statusBars`, `layout.controlBars` and `theme` are new settings keys, so
  a `workspace.json` written before this change still loads — they are all optional.

## Verification

`npm run typecheck && npm run lint`, `npm test`, and
`npx electron-vite build && node scripts/e2e.mjs`, which drives the built application through: every
slot rendering its panels as tabs, closing a panel and adding it back from the slot's own menu, the
grid having no close button, the settings editor mounting under `script-src 'self'` and being typed
into, the theme picker previewing and reverting, the minimap sizing itself to the patch and painting
it, and a two-finger scroll panning where a wheel click zooms.
