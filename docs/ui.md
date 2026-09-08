# The interface

The window is a dock of slots, each slot a tab strip of panels, and what is in which slot is a
setting rather than a fact about the code. This describes how the pieces fit and what adding one
costs.

Most of this is copied from OSMC, which is where the patterns come from. Where it differs, the
difference is noted and the reason given.

## Colour

Colours exist twice.

`src/renderer/src/css/theme.css` declares them as custom properties and maps each into Tailwind's
`@theme` block, which is what makes `bg-background`, `text-muted-foreground`, `border-border` and
`text-signal-audio` exist as classes. `src/renderer/src/theming/themes/*.ts` holds the same values
again, because the Pixi canvas cannot read a stylesheet and the grid renderer needs them as data.

Two lists of the same thing drift, so `theming/theme-parity.test.ts` reads the stylesheet and fails
if a theme's block and its object disagree about a key, a value, or a missing `@theme` mapping.
Change one and the test names the other. All three failure modes were checked by introducing them.

Naming is mechanical, and the test depends on it:

| In TypeScript | As a custom property | As a class |
| --- | --- | --- |
| `colors.cardForeground` | `--card-foreground` | `text-card-foreground` |
| `grid.gridLine` | `--grid-line` | `text-grid-line` |
| `grid.signal.audio` | `--signal-audio` | `text-signal-audio` |

Interface colours may be any CSS colour; the `oklch` ones came from OSMC. **Grid colours must be
`#rrggbb`** — `hexToNumber` in `lib/color.ts` is what turns a colour into the integer Pixi wants and
it parses nothing else, so an `oklch` grid colour renders as black.

Adding a colour is four edits: the `UIColors` or `GridColors` interface, all three theme objects, the
`@theme` mapping, and all three `[data-theme]` blocks. The test checks the last two against the
first.

`applyTheme` only writes `data-theme` and `color-scheme`; the stylesheet owns the values. The store
that holds the active theme touches nothing — `watchTheme` puts it on the document, the way
`watchEngine` connects a store to the world elsewhere — which is what lets a theme be switched in a
test with no DOM.

**`grid-theme-store`** is what the canvas actually reads: the active theme's grid colours with the
settings file's `grid.*` and `signal.*` overrides on top, recomputed when either changes. That is
why a colour typed into `workspace.json` repaints the canvas without a reload. It ignores anything it
cannot draw.

## The dock

`components/dock/Dock.tsx` is a centre surface with a column either side and a strip above and below.
Two rules make it a dock rather than a picture of one: a slot with nothing in it takes no space at
all, and a column with only one of its two panels gives that panel the whole column. Emptying a slot
has to give the room back.

Sizes are stored as fractions of the window, so a layout saved on a large display still makes sense
on a small one. Dragging works in pixels, because that is what a pointer reports; the conversion
happens in `Dock.tsx`, once, where a drag becomes a stored size.

**Where the layout lives is split on purpose.** Column widths and split ratios are about your
monitor, so they stay in `userData` under `layout` and do not travel with a workspace. Which panel
is in which slot is about how you work, so it lives in the workspace's settings under
`layout.widgets` — which is also what makes rearranging the window and editing `workspace.json` the
same operation reached two ways.

## Panels

A panel is a `WidgetDefinition`: a name, a label, an icon, a component, and what it will and will not
tolerate about placement.

```ts
export const scopeWidget: WidgetDefinition = {
  id: "scope",
  label: "Scope",
  icon: Activity,
  component: ScopeWidgetComponent,
  defaultSlot: "right-bottom",
  scrollable: false,
  scope: "scope",
};
```

Adding one is three edits: a line in `config/registry-ids.ts`, a definition file under
`components/widgets/definitions/`, and a line in `register-widgets.ts`. The id goes in
`registry-ids.ts` because the settings schema derives a Zod enum from it, and that is what makes the
settings editor complete a panel name and underline a typo.

`scope` is phasegrid's own addition to OSMC's definition: `WidgetSlot` puts it on the panel as
`data-kb-scope`, so a keybinding scoped to that name applies while focus is inside — which is how a
panel overrides a global shortcut.

Placement is declarative so the interface can refuse rather than allow and then misbehave:

- `size: "wide"` — only the centre slots. The grid and the settings editor are useless in a sidebar.
- `placement.allowedSlots` — a whitelist.
- `placement.unique` — at most one across the whole layout.
- `placement.pinned` — cannot be closed, and cannot leave its default slot.

A pinned panel missing from the settings file is put back in its own slot when the layout is read.
That matters for the grid: nothing in the interface could put it back, so a hand-edited file must not
be able to remove it permanently. The rules live in `widget-layout-store.ts` and are tested there.

**The centre keeps two levels of tab.** The outer one is the dock's, putting the grid beside the
settings editor. The inner one is the document's, one tab per open project. They answer different
questions — what am I looking at, and which piece am I working on — and collapsing them would make
closing a project and closing a panel the same gesture. The centre slot is `keepMounted`, because the
grid owns a canvas with a graphics context and an engine subscription and looking at the settings
should not throw both away.

Status bar items and control bars follow the same shape, in `components/status-bars/` and
`components/control-bars/`, keyed off `layout.statusBars` and `layout.controlBars`. A control bar
floats in a corner of the canvas; the space around it stays draggable.

## Settings

`config/defaults.ts` is the one table of what a setting is: its type, its default, and a description
that becomes a tooltip. `config/config-schema.ts` turns it into a Zod schema doing two jobs —
validating what was typed at runtime, and becoming the JSON Schema the editor completes against. The
two cannot disagree about what is allowed because they are generated from the same source.

`.strict()`, at every level. An unknown key is almost always a misspelling of a known one, and a
misspelling that validates is a setting that appears to be set and is not. The nested layout objects
are strict too, or the editor would reject a bad slot name that the runtime accepted.

Text that does not parse — or parses and fails the schema — stays on screen and never reaches the
file. The application keeps running on the last configuration that made sense, which is what lets
someone edit freely rather than in one keystroke that has to be right.

The panel is three tabs: Overrides is what you wrote, Defaults is what shipped, Calculated is what
the application is running on. Three rather than one because "why is this value what it is" is the
question a settings file eventually raises, and the answer is the difference between two of them.

**Monaco is imported narrowly and loaded late.** `import * as monaco from "monaco-editor"` registers
every language it ships — abap, solidity, freemarker — which was a 7.7 MB chunk and ninety tokenizer
files for a window that only opens JSON; naming it in `manualChunks` pulls the same barrel back in
along with a 13 MB TypeScript worker. `components/monaco-editor.ts` imports `editor/editor.api` and
the JSON language service directly, and `SettingsWidget` reaches the panel through a dynamic import,
so the startup chunk stays small and Monaco is fetched the first time the tab is opened. Two workers,
not five. Note the specifiers omit `esm/vs/` — the package's `exports` map already adds it.

The colour provider offers hex presentations only: the canvas reads those with `hexToNumber`, so
offering `rgb()` would let the picker write a colour the grid renders as black.

## The inspector

The selected module's parameters, as a form built from `ModuleDescriptor` — the label, the range, the
unit and the enum labels all come from what the engine prints, so a module added to the engine gets a
working inspector with no change here. `patch/module-schema.ts` is the whole of it.

Edits go through `patchStore.apply` with a `paramSet` op carrying its own inverse, which is the path
a knob drag on the canvas already takes. That is what makes an edit here undoable, reach the engine,
and turn the knob on the canvas without any of it being wired twice. The push compares against the
document rather than against the last value pushed, so a parameter the canvas is moving does not look
like an edit to send back.

Parameter keys are prefixed `param:`. A module is free to name a parameter `id` or `name`, and a
collision with the identity fields would silently show the wrong value in one of the two places.

A structural parameter is shown but not editable — the engine rebuilds the node to change one, which
is not something to offer behind a field that looks like every other field. A hidden one is left out.

It defaults to `center-bottom` rather than a sidebar: the form is label-and-value rows, and a sidebar
wide enough for the values is a sidebar that has taken the room the grid wanted.

## The canvas

`grid/viewport.ts` is the transform. `grid/viewport-store.ts` holds the one live viewport so panels
outside the canvas can read and move it — the minimap and the zoom control both do. It is not a
zustand store because nothing renders from it; everything that reads it does so inside an animation
frame.

One `wheel` event carries four gestures and telling them apart is the whole of making the canvas feel
right. `grid/wheel.ts` is that judgement, pure and tested per gesture:

| What arrives | What it is | What it does |
| --- | --- | --- |
| `ctrlKey`, no key held | trackpad pinch | zoom about the pointer, proportional |
| `metaKey` held | a deliberate ask | zoom about the pointer, stepped |
| small pixel deltas, both axes | two-finger scroll | **pan** |
| line deltas, or large pixel steps | mouse wheel | zoom about the pointer, stepped |

The two-finger scroll is the important one: it is how anyone moves around a canvas on a laptop, and
binding it to zoom is what made scrolling lurch the patch towards and away from you instead of
moving it. Space-and-drag and middle-drag pan as well, and a two-finger pinch zooms about its centre.
Left-drag on empty canvas stays a marquee.

phasegrid deliberately has **no armed tool modes**. OSMC's canvas is modal — you arm Grab or Select
or Road and the canvas behaves accordingly — because it is a map. Here every gesture is direct: drag
a module, drag from a port to make a cable, drag a knob. Nothing needs arming, so `tools/` was not
copied.

## The minimap

The patch at one pixel per grid cell, painted by whatever registered a drawer. The minimap knows
nothing about modules or cables — only that some things can colour a cell.

**This is where phasegrid differs most from OSMC.** OSMC's world is a bounded grid, so its buffer is
the size of the world and never changes shape. A patch is an unbounded plane, so `grid/patch-bounds.ts`
computes the rectangle the patch occupies and the buffer is sized from that, reallocated only when the
extent changes shape — moving a module inside the existing bounds keeps the same buffer. `patchBounds`
lives in `grid/` rather than in the minimap because the rectangle a patch occupies is a fact about a
patch, and the zoom-to-fit button needs it too.

A drawer paints in **patch-cell coordinates**; the origin offset is applied for it, so it never learns
that the buffer is a window onto somewhere larger.

```ts
export const modulesDrawer: MinimapDrawer = {
  id: "modules",
  layer: "static",
  staticKey: (doc) => doc.modules,
  draw({ paint, doc, catalog, colors }) { /* paint(cellX, cellY, r, g, b) */ },
};
```

`layer` is what keeps it cheap. A `"static"` drawer runs only when the slice its `staticKey` returns
changes identity; a `"dynamic"` one runs every frame. Repainting the first at the second's rate is
most of the cost of a naive minimap.

Drawers write into a structural `MinimapBuffer` rather than an `ImageData` — a type they do not need
and which does not exist outside a browser, so they are tested without a DOM. Registration order is
paint order: cables are registered before modules, so a module covers the cable reaching it and the
connection reads as plugged in.

Modules are coloured by the role of their first output, straight from the engine's descriptors, so a
patch reads as its signal flow and a new module needs no change here.

The white rectangle is the canvas's view. Drag inside it to move the canvas, outside it to move the
map, wheel over either to zoom that one, double-click to fit.

## Not copied from OSMC

Named so the absences are decisions rather than oversights. OSMC's `data-grid/` (thirty-odd files),
`charts/`, `floating/toast/`, `router/`, `services/storage/`, `demos/` and `tools/` have no consumer
here. Its modal was replaced rather than copied: phasegrid stays on the platform's `<dialog>`, which
gives a real focus trap and the top layer for free instead of a headless UI dependency. Its command
palette filter was replaced by phasegrid's subsequence ranking, which puts "Add Module" first when
you type `adm` where a substring filter finds nothing.
