# The workspace

phasegrid2 opens a **workspace**, not a project. A workspace is one folder holding many projects, the
settings, and — in time — the modules you build yourself. That last part is why it is a folder: a
user-authored module belongs beside the projects that use it, not inside one of them.

On launch the application reopens the workspace you were last in, and the projects you had open in it.
With no workspace it shows a gate and opens nothing until you pick a folder. Any folder will do: one
that is not a workspace yet is scaffolded into one, and nothing already in it is touched.

## Layout

```
<workspace>/
  workspace.json          the settings
  projects/
    my-track/
      project.json        one project
  modules/                reserved for modules you build
  .phasegrid/
    session.json          which tabs were open
  .gitignore              ".phasegrid/"
```

A project's folder name is the only record of where it lives — the document does not store its own
path. Renaming or moving the folder moves the project rather than leaving a file pointing at nothing.
Folder names are lower case, digits and dashes (`^[a-z0-9][a-z0-9-]{0,63}$`), derived from the project's
name; a clash gets `-2`, `-3`, so saving never lands on top of someone else's work.

`.phasegrid/` is this machine's state rather than the workspace's, which is why the scaffolded
`.gitignore` excludes it: a workspace kept in version control should not carry one machine's open tabs
to another.

## Settings

`workspace.json` holds everything you can configure:

```json
{
  "schemaVersion": 1,
  "name": "my-workspace",
  "settings": {
    "ui.theme": "dark",
    "grid.snap": 16
  }
}
```

`settings` contains only what you changed. The defaults live in the application
(`src/renderer/src/config/config-store.ts`, `DEFAULT_CONFIG`) and your values are merged over them, so a
key you have not set behaves as it always did — and the Settings panel lists every key with its
effective value, marking the ones you have overridden.

Two things do **not** live here, because they belong to the installation rather than to the folder: the
dock layout, which is shaped by the screen in front of you, and the pointer to the workspace you were
last in. Both are under Electron's `userData`.

The Settings panel edits `settings` as text. Text that does not parse stays on screen and is never
written, so what is on disk always loads. Fields you add to `workspace.json` by hand outside `settings`
are preserved; whitespace *inside* `settings` is regenerated when the application writes it.

## Keybindings

Keybindings are one setting among the rest:

```json
{
  "settings": {
    "keybindings": [
      { "key": "mod+alt+t", "command": "project.save" },
      { "key": "mod+b", "remove": true },
      { "key": "delete", "command": "patch.deleteSelection",
        "scope": "grid", "when": "hasSelection" }
    ]
  }
}
```

Your bindings are added **after** the ones the application ships with, and the last binding registered
wins, so a file says what you changed rather than restating everything you did not.

- `key` — `mod` is command on Apple platforms and control elsewhere, so one file suits both. Then
  `ctrl`, `alt`, `shift`, in that order: `mod+shift+p`, `alt+f`, `escape`, `space`.
- `command` — any command id; the palette (`⌘K`) lists them all.
- `remove` — takes a binding away instead of adding one. With no `command` it clears the key entirely;
  with one it clears only that pairing. Needed because bindings append rather than replace.
- `scope` — a focus region (`grid`, `catalog`, `settings`, `modal`, …). A scoped binding beats an
  unscoped one, so a widget can override a global shortcut without knowing what the global one is.
- `when` — an expression over `modalOpen`, `hasSelection`, `engineReady` and `focus`, with `!`, `&&`,
  `||`, `==` and `!=`.

A `keybindings` value that does not validate leaves the previous bindings in place and reports why in
the Settings panel. A malformed file must not leave you with no keyboard — including no way to reach the
editor that would fix it.

## Saving

Projects never save themselves. A project with unsaved work shows a dot in its tab and a live **Save**
button in its header; `⌘S` saves, `⌘⇧S` saves under a new name. Closing a tab, switching workspace or
quitting asks first, and Cancel genuinely cancels.

A project that has never been saved is filed under the name it already has, so saving never stops to ask
where things go. An **example** is the exception: it has nowhere to save to, and saving one asks for a
name, writes it into the workspace, and the tab stops being an example.

Deleting a project from the Projects panel removes its folder. A tab open on it stays open, as a project
that has never been saved — deleting the file is not a reason to throw away what is on screen.

## Editing

Select modules on the grid — click one, shift-click to add, or drag a marquee across the canvas — and
press Delete or Backspace to remove them. The cables attached to them go with them, as one undo entry:
removing a module already takes its edges in `applyOps`, in `invert`, and in the engine's own
`GraphModel::removeNode`, so nothing describes that twice.

Deleting does nothing in an example, whose wiring is fixed. Saving an example under a name makes it a
project of your own, and it unlocks in the same moment — the canvas is asked each gesture rather than
told once when it was built.

## Boundaries

The renderer never touches the filesystem. It picks a workspace through a dialog the main process owns
and thereafter names a project only by its slug; `src/main/workspace/path-guard.ts` is the one place that
turns either into a path, and it refuses anything that resolves outside the workspace root. Every write
is a temp file followed by a rename, so a reader never sees half a file.
