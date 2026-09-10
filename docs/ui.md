# The interface

The window is a dock of slots, each slot a tab strip of panels, and what is in which slot is a
setting rather than a fact about the code. This describes how the pieces fit and what adding one
costs.

Most of this is copied from OSMC, which is where the patterns come from. Where it differs, the
difference is noted and the reason given.

## Colour

The palette lives once, in `theming/themes/*.ts`, and reaches the page as data.

`css/theme.css` says only what each colour is *called*: an `@theme` block mapping
`--color-background: var(--background)` and so on, which is what makes `bg-background`,
`text-muted-foreground`, `border-border` and `text-signal-audio` exist as classes. It holds no
values. Tailwind resolves `var(--background)` per element at runtime, so a name declared there with
nothing behind it yet is fine.

The values are generated. `theming/theme-variables.ts` turns each theme into a
`[data-theme="id"] { … }` rule and injects them all as one `<style>` element at startup — and again
whenever the set of themes changes, which is how a workspace can define one. This is Nubase's
arrangement, and it is why the theme can be typed, stored in JSON and overridden per workspace.

Two values are still written twice: `--background` and `--foreground`, in a bare `:root` block. They
are the only colours that show in the one frame between the browser applying the stylesheet and the
script running. Everything else deliberately has no fallback, so a colour missing from the generated
sheet is visibly missing rather than quietly some other theme's. `theme-parity.test.ts` checks those
two against the default theme, and checks that every colour has a `@theme` mapping — a class Tailwind
never heard of produces no rule, which looks exactly like a class that produces the wrong one.

Naming is mechanical, and the generator and the test share the rule:

| In TypeScript | As a custom property | As a class |
| --- | --- | --- |
| `colors.cardForeground` | `--card-foreground` | `text-card-foreground` |
| `grid.gridLine` | `--grid-line` | `text-grid-line` |
| `grid.signal.audio` | `--signal-audio` | `text-signal-audio` |

Interface colours may be any CSS colour; the `oklch` ones came from OSMC. **Grid colours must be
`#rrggbb`** — `hexToNumber` in `lib/color.ts` is what turns a colour into the integer Pixi wants and
it parses nothing else, so an `oklch` grid colour would render as black. A workspace theme or an
override that puts one there is dropped rather than drawn.

Adding a colour is two edits: the `UIColors` or `GridColors` interface (the compiler then demands the
theme objects), and one line in the `@theme` block.

`applyTheme` only writes `data-theme` and `color-scheme`; everything else follows from the cascade.
The store that holds the active theme touches nothing — `watchTheme` puts it on the document, the way
`watchEngine` connects a store to the world elsewhere — which is what lets a theme be switched in a
test with no DOM.

### What a workspace can change

Two settings, resolved together in `theming/workspace-themes.ts` into the one list the store holds —
so a colour written in `workspace.json` reaches the panels and the canvas by the same route.

`ui.theme` is the theme the window opens in, and choosing one in the picker writes it. Only choosing:
the picker previews as you arrow through it, and writing on every preview would put a dozen entries
through the save path for one decision.

`theme` overrides individual colours on whichever theme is active, as flat dot-paths — `ui.background`,
`grid.gridLine`, `signal.audio`. Applied to every theme rather than only the active one:
observationally the same, since one is active at a time, and it means the generated stylesheet is
correct without knowing which.

`themes` defines whole themes, keyed by id, each saying only what differs from the theme it
`extends`:

```json
"themes": {
  "midnight": {
    "name": "Midnight",
    "extends": "dark",
    "colors": { "background": "oklch(0.1 0.02 260)" },
    "grid": { "gridLine": "#1a1f2e", "signal": { "audio": "#ff5c5c" } }
  }
}
```

They appear in the picker beside the built-ins. An id matching a built-in replaces it, because "dark,
but a bit different" is the obvious thing to want and the alternative is making people invent a
second name for it. A theme that does not validate is left out and the rest are kept: one malformed
entry should cost that entry, not every theme in the file.

There is no separate store for the canvas's colours. Overrides are resolved into the theme objects
before anything reads them, so the canvas reads the active theme and that is all.

### Colours for things that cannot read CSS

`lib/css-color.ts` resolves any CSS colour — or a `var(--name)` reference — to hex, by setting it as a
`background-color`, reading the computed value, and painting it onto a 1×1 canvas when that value is a
syntax no regex should parse. The canvas does the colour-space conversion.

This is not a theoretical fallback: Chromium serialises `oklch` verbatim, so the computed value of
`--background` is not something `rgbToHex` can read, and the canvas step is what actually produces the
colour. The e2e check does both steps for that reason.

It exists for the places handed a *resolved* colour with nowhere else to get one — currently the
settings editor's Monaco theme. **Not** for the canvas's palette, which stays in the theme objects
and is read directly, keeping that path pure and testable.

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

**The editor is in the application's colours.** `components/monaco-theme.ts` derives Monaco's whole
palette from custom properties — ground, gutter, selection, the suggest and hover widgets, the
scrollbar, and four syntax slots mapped onto the signal-role colours the canvas already draws, so a
JSON key is the colour a phase cable is. It re-derives on `data-theme` via a `MutationObserver`
rather than a store subscription, because it reads the *resolved* value of a property: it has to run
after the attribute is on the document and the new values have cascaded, not when the store changed.
`isDark` picks the base theme from the background's luminance rather than the theme's declared
`type`, since a workspace theme can say `dark` over a pale ground.

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

A structural parameter is edited like any other, committed on change rather than dragged; its help says
that the engine rebuilds the node to apply it, which is how an instrument's Voices is set. A hidden one is
left out.

It defaults to `center-bottom` rather than a sidebar: the form is label-and-value rows, and a sidebar
wide enough for the values is a sidebar that has taken the room the grid wanted.

## The canvas

**The same project has two views.** The header's Grid | Source toggle (`project.toggleSource`) swaps
the canvas for the project as the text Save writes -- `projectText`, the one function the save path
uses, so the view is byte for byte the file -- in the Monaco editor the settings and the pattern fields
already use, with a JSON schema generated from the project's Zod schema bound to the model's URI
(`phasegrid://project/<id>.json`; the settings schema is bound to its own). Cmd+Enter parses the
text, puts it through the schema, and `replace`s the document the way opening a file would, so the
engine hears the patch and the header follows the tempo; invalid text is reported under the editor and
changes nothing. The grid stays mounted underneath, invisible, because it owns a canvas and an engine
subscription that a toggle should not rebuild. `project.revealFile` shows the file itself.

**A module is a face made of blocks.** On the canvas a module is a rectangle of 24 px cells, and
what it wears is a composition of blocks — the title, a jack, a knob, a wave panel, a scope, a readout — each covering a
whole number of cells, the way a hardware panel is a grid of tiles. The title is a block like the
others, one row across the module's whole width at row 0; the rows the engine declares sit under it. Which blocks and where
is the engine's to say: the descriptor carries `face`, rows of tokens in the manner of CSS
`grid-template-areas` (docs/adding-a-module.md), and `grid/face.ts` turns them into geometry —
`composeFace(descriptor)` — or composes a face by rule for a module that declared none (ports down
the sides, primary knobs between, the wave first). That geometry is the one truth: `NodeView` builds
one Pixi block per face block (`grid/components/blocks/`, one file per kind, `Block.ts` the contract
they share), the hit test reads the same numbers, the minimap and the catalogue read the footprint,
and `pg.grid.face(module)` reports the blocks to a script. There is no table of module ids to
appearances anywhere, and no `instanceof` on what kind of module a node is: adding a kind of block is
one file and a line in `NodeView`'s table, and adding a module is nothing here at all.

Every block sits on a **tile**: a filled key in `tileFill` with a `tileStroke` hairline, filling
its cells edge to edge (the gutter and corner radius are constants, both zero for now, in
`grid/layout.ts` and `blocks/Block.ts`), so a face reads as a panel of keys and the module's own
frame, a square `nodeFill` rectangle with a `nodeStroke` border, shows only through empty cells. The wave's tile is its screen: the
picture fills it and the tile's edge is the bezel. The scope is the same screen showing a different
thing: not what the module would play but what is on the wire into it, the window the engine
publishes for a `publishesScope` module (docs/telemetry.md), read at frame rate by
`telemetry-sync.ts` and drawn by `blocks/ScopeBlock.ts` from a rising zero crossing so a tone holds
still, each column the least and greatest sample that fell in it so noise reads as a band rather
than a slower wave that is not there. Two kinds of block rather than one with a mode, because a node
routes a picture to one and a trace to the other and never has to ask.

The readout (`blocks/ValueBlock.ts`) is the third of that family and the only one that is not a
screen: it is a number on an ordinary tile, monospaced, because a value that changes sixty times a
second in a proportional font shifts its digits sideways as they change. It shows one number for a
signal whose channels agree and one per channel when they do not, so a mono control voltage is one
reading rather than two identical ones.

The keyboard (`blocks/PianoBlock.ts`) is the fourth: white and black keys across an ordinary tile,
the ones being played lit in the pitch signal's colour, fed by the `Keys` the engine publishes for a
`publishesKeys` module. Its range is two of the module's own parameters -- Octaves on the face, Low
in the inspector -- read from the document the way a knob's value is, so turning one reshapes the
keys at once; the keyboard fills its block whatever the range, since the face is the engine's to
declare and does not change with a knob.

A cable leaving a module inside an instrument through a continuous port is drawn heavier
(`CABLE_POLY_EXTRA` in `grid/components/Cable.ts`), the way a polyphonic wire is in a modular that has
them: it carries one signal per voice. Which modules those are is the engine's knowledge — every commit
answers with `domains`, kept in the engine store and handed to `GridRenderer.setDomains` — so the canvas
never guesses at it, and the inspector's first line says whether the selected module runs once or per
voice of which converter.

Every place a cable can plug in is a `Socket` with a `facing`: a jack's, inside its tile under the
port's name, and the one in the bottom right corner of every knob tile whose parameter can be
modulated (the implicit `param:<id>` port — a cable dropped on the knob lands there). Cables leave a
socket the way it faces, so a knob's socket takes its cable from below and a jack in the left column
from the left. What is drawn over what is one list, `WORLD_LAYERS` in `grid/GridRenderer.ts`: the
modules, then the selection rings, then the cables over both, since every socket is inside a module;
the marquee and a dragged cable sit above all of it in the screen-space overlay.

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

Its theme arrangement was replaced too, by the one in **Nubase** (`/Users/andrepena/gitp/nubase`),
which is where this structure originally came from: OSMC writes the palette out twice, once as CSS
and once as TypeScript, and the two drift. Nubase keeps the values in TypeScript and generates the
CSS, which is what the Colour section above describes. Nubase's `runtime-theme-generator.ts`,
`monaco-theme.ts` and type scale are all taken from there.
