# Workspace and project save

## The problem

phasegrid2 can open projects but cannot keep them. `emptyProject()` mints a document in memory,
`ProjectDocSchema` carries an optional `path` nothing ever writes, and closing a tab discards the work.

Settings are half-built in the same way. `config-store.ts` implements the defaults-plus-overrides model
faithfully, but writes to `userData/settings/config.json` where nobody can find it, and
`userData/settings/keybindings.json` is declared in `STORAGE_KEYS` and never read: `use-keybindings.ts`
registers `DEFAULT_KEYBINDINGS` and stops there, so a user cannot rebind anything.

## The unit of persistence is a workspace

A workspace is one folder holding many projects, the global settings, and — later — the instruments and
modules a user builds. That last part is the reason it is a folder rather than a file. A user-authored
module belongs beside the projects that use it, not inside one of them, and a format that starts as
"a project is a file" has to be broken later to admit that.

Launching phasegrid2 opens the workspace you were last in, and the projects you had open in it. With no
workspace it opens nothing until you pick a folder, and scaffolds that folder if it is not one yet.

Projects never save themselves. A project with unsaved work is marked, and saving is something a person
does. Autosave in a tool that makes sound is a way to lose the take you liked.

## Layout on disk

```
<workspace>/
  workspace.json
  projects/<slug>/project.json
  modules/                      (empty; reserved for user-built modules)
  .phasegrid/session.json
  .gitignore                    ( ".phasegrid/" )
```

`workspace.json`:

```json
{
  "schemaVersion": 1,
  "name": "my-workspace",
  "settings": {
    "ui.theme": "dark",
    "grid.snap": 8,
    "keybindings": [{ "key": "mod+alt+t", "command": "workbench.cycleTheme" }]
  }
}
```

`settings` is exactly the `ConfigRecord` that `config-store` already holds as `overrides`; the defaults
stay in `DEFAULT_CONFIG` in code. Keybindings are one key in it rather than a file of their own, because
a keybinding is a setting and a second file is a second place to look.

`.phasegrid/session.json` is `{ "schemaVersion": 1, "open": ["my-track"], "active": "my-track" }`. Slugs,
so examples — which have no slug, because they have nowhere on disk — cannot appear in it.

Slugs match `^[a-z0-9][a-z0-9-]{0,63}$`, derived from the project's name and uniquified with `-2`, `-3`.
A project's folder name is the only record of where it lives: the document does not store its own path,
so moving or renaming the folder re-slugs the project rather than leaving it pointing at nothing.

## What lives where

workspace.json owns the settings. The application's own storage under `userData` keeps two things: the
dock layout, which is shaped by the screen rather than by the folder, and a pointer holding the last
workspace path and the recent list. Nothing else. A workspace copied to another machine arrives complete
and does not drag that machine's panel sizes with it.

## Boundaries

**The renderer never touches the filesystem.** Every path is resolved in the main process, inside the
workspace root, by one guard; a slug that escapes the root is refused there rather than trusted because
it came from our own renderer. IPC is a boundary, and a boundary that trusts its input is not one.

**One channel.** `workspace:call` carries an op name validated in main, following `engine:call` rather
than growing a dozen `storage:*`-shaped channels for one feature.

**Every write is atomic.** Temp file, then rename, which is the only way a reader never sees half a file.
The writer already in `app-storage.ts` is lifted out and used by both.

## Keybinding overrides

`KeybindingRegistry.setBindings` already resolves ties by "last registered wins", so user bindings are
appended after the defaults and win on any key they repeat. Because they append rather than replace,
removing a default needs syntax: an entry with `"remove": true` drops earlier bindings on that key (and
on that command, if one is given). A boolean field rather than VS Code's `-command` prefix, because the
file is already objects and a flag is self-describing where a sigil is not.

A `keybindings` value that does not validate leaves the previous bindings in place. A malformed settings
file must not leave the application with no keyboard.

## Unsaved work

A dirty project carries a dot in its tab and a live Save button in its header. Closing it, switching
workspace or quitting asks — natively, Save / Don't Save / Cancel — and Cancel genuinely cancels.

Window close and quit use one mechanism: main refuses the close once and asks the renderer, the renderer
runs its save flow, then tells main the window may go. No mirror of the dirty state in main, because a
mirror is a second source of truth that will eventually disagree with the first.

## Examples

An example has nowhere to save to, which is why its wiring is fixed. Saving one performs Save As into the
workspace: it asks for a name, writes `projects/<slug>/project.json`, and the tab stops being an example.
Turning a demonstration you have been fiddling with into real work is the obvious next move, and refusing
it would be pedantry.
