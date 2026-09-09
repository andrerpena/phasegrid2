import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { until } from "../harness.mjs";

/**
 * A project saved for the first time, the settings editor writing to the workspace and taking
 * effect without a relaunch, and the dock's panels being closed and put back.
 *
 * Nothing here sleeps. Where a fact takes a moment to become true, the wait names the fact: the
 * dialog is open, the colour reached CSS, the project is no longer dirty, the settings write
 * reached the file. `idle()` covers that last one, which is the one that is easy to forget --
 * a settings write is fired and forgotten, so the store moves before the file does.
 */
export default {
  name: "save-settings-dock",
  description:
    "save as, settings and keybindings live, themes, the dock, and the path guard",
  async run({
    workspace: ws,
    evaluate,
    text,
    idle,
    waitFor,
    checkEventually,
    screenshot,
    replaceDocument,
    mouse,
    check,
  }) {
    await evaluate(`click("button", "+");`);
    await waitFor("window.pg.snapshot().projects.open.length === 1", {
      label: "a new project opens",
    });
    await evaluate(
      `setValue(document.querySelector('input[aria-label="Tempo"]'), "137");`,
    );
    await waitFor("window.pg.snapshot().projects.open[0].dirty === true", {
      label: "editing the tempo marks the project unsaved",
    });
    check("the tab shows a dot once edited", (await text()).includes("•"));
    check(
      "the button offers Save As, having nowhere to save yet",
      (await text()).includes("Save As…"),
    );

    await evaluate(`click("button", "Save As…");`);
    await waitFor(
      `document.querySelector('[data-testid="save-as"]') !== null`,
      {
        label: "the Save As dialog is open",
      },
    );
    await evaluate(
      `setValue(document.querySelector("dialog input"), "My Track");`,
    );
    await waitFor(
      `document.querySelector("dialog input").value === "My Track"`,
      { label: "the name is typed" },
    );
    const hint = await evaluate(
      "return document.querySelector('dialog')?.innerText ?? '';",
    );
    check(
      "the dialog shows the folder it will make",
      hint.includes("projects/my-track/"),
      hint,
    );
    await evaluate(
      `[...document.querySelectorAll("dialog button")].find((b) => b.textContent.trim() === "Save").click();`,
    );
    await waitFor("window.pg.snapshot().projects.open[0].dirty === false", {
      label: "the project is saved",
    });

    const file = join(ws, "projects", "my-track", "project.json");
    check("the project is on disk", existsSync(file));
    if (existsSync(file)) {
      const doc = JSON.parse(readFileSync(file, "utf8"));
      check(
        "it saved the tempo that was typed",
        doc.tempo === 137,
        String(doc.tempo),
      );
      check("it saved under the name given", doc.name === "My Track", doc.name);
      check("it does not record its own path", doc.slug === undefined);
    }
    const after = await text();
    check("the dot cleared", !after.includes("•"));
    check("the Projects panel lists it", after.includes("My Track"));

    // The session is written on a debounce of its own, so it is waited for from here rather than
    // through `idle`, which knows nothing about that timer.
    const session = await until(
      () => {
        try {
          const parsed = JSON.parse(
            readFileSync(join(ws, ".phasegrid", "session.json"), "utf8"),
          );
          return parsed.open.includes("my-track") ? parsed : null;
        } catch {
          return null;
        }
      },
      { label: "the session file records the open tab" },
    );
    check(
      "and which tab was in front",
      session.active === "my-track",
      JSON.stringify(session),
    );

    // The settings panel is kept mounted behind the grid, and must be truly hidden there: its own
    // inner tab strip once declared itself visible and painted its toolbar and editor over the grid
    // while the Grid tab was selected. `offsetParent` is null exactly when an element is
    // `display: none`, which no descendant can undo.
    const settingsToolbarShown = `(() => { const b = [...document.querySelectorAll('[data-widget="settings"] button')].find((x) => x.textContent.includes("Reset")); return b !== undefined && b.offsetParent !== null; })()`;
    check(
      "the settings panel paints nothing while the grid is in front",
      (await evaluate(`return ${settingsToolbarShown};`)) === false,
    );
    // And it is not built at all until it is opened. The editor behind it is several megabytes
    // fetched by a dynamic import; keeping the panel mounted used to mean building it at launch,
    // which is what that import exists to avoid.
    const editorBuilt = `document.querySelector('[data-widget="settings"] .monaco-editor') !== null`;
    check(
      "and the editor is not built until the tab is opened",
      (await evaluate(`return ${editorBuilt};`)) === false,
    );

    // Settings, and a keybinding taking effect without a relaunch.
    await evaluate(`click('[role="tab"]', "Settings");`);
    await checkEventually("opening the tab builds the editor", editorBuilt, {
      timeoutMs: 15000,
    });
    // The catalogue's own search field: present exactly when the left column is. Matching on the
    // panel title does not work, because the title is uppercased by the stylesheet.
    const leftShown = `document.querySelector('[data-kb-scope="catalog"]') !== null`;
    await evaluate(`press("b", { metaKey: true });`);
    await checkEventually(
      "mod+b toggles the left panel by default",
      `${leftShown} === false`,
    );
    await evaluate(`press("b", { metaKey: true });`);
    await checkEventually("and toggles it back", leftShown);

    // ── The dock: a panel can be closed, and put back from the slot it left ──
    await screenshot("shell");
    const tabNames = () =>
      evaluate(
        `return [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim());`,
      );
    const tabs = await tabNames();
    check(
      "every slot renders its panels as tabs",
      [
        "Catalog",
        "Projects",
        "History",
        "Grid",
        "Settings",
        "Log",
        "Inspector",
        "Scope",
        "Performance",
      ].every((name) => tabs.includes(name)),
      JSON.stringify(tabs),
    );
    await evaluate(
      `[...document.querySelectorAll('[aria-label="Close Performance"]')][0].click();`,
    );
    await checkEventually(
      "closing a panel removes its tab",
      `[...document.querySelectorAll('[role="tab"]')].every((t) => t.textContent.trim() !== "Performance")`,
    );
    // Closing writes the layout to the workspace, which is the point of it living in the settings.
    // `idle` is what makes that write have happened rather than be about to.
    await idle();
    const savedLayout = JSON.parse(
      readFileSync(join(ws, "workspace.json"), "utf8"),
    ).settings["layout.widgets"];
    check(
      "and the workspace remembers the layout",
      Array.isArray(savedLayout?.["right-bottom"]) &&
        !savedLayout["right-bottom"].includes("performance"),
      JSON.stringify(savedLayout),
    );
    // The `+` on a slot's strip offers exactly what is missing. Opened with a pointerdown rather
    // than a click: that is the event the menu listens for.
    await evaluate(
      `const add = document.querySelector('[aria-label="Add a panel to right-bottom"]');
       add.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerType: "mouse" }));
       add.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerType: "mouse" }));`,
    );
    await waitFor(`document.querySelectorAll('[role="menuitem"]').length > 0`, {
      label: "the add-panel menu is open",
    });
    const offered = await evaluate(
      `return [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent.trim());`,
    );
    check(
      "the add-panel menu offers the one that was closed",
      offered.includes("Performance"),
      JSON.stringify(offered),
    );
    await evaluate(
      `[...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.trim() === "Performance").click();`,
    );
    await checkEventually(
      "and adding it back restores the tab",
      `[...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent.trim() === "Performance")`,
    );
    // A pinned panel has no close button at all: nothing in the interface could put the grid back.
    check(
      "the grid cannot be closed",
      (await evaluate(
        `return document.querySelector('[aria-label="Close Grid"]') === null;`,
      )) === true,
    );

    // The settings editor owns its own DOM and model, so there is no value to set: the only honest
    // way in is to click into it, select everything and type -- which is the path a person takes.
    check(
      "the settings editor mounts under the content policy",
      (await evaluate(
        `return document.querySelector(".monaco-editor") !== null;`,
      )) === true,
    );
    await screenshot("settings");
    const typeSettings = async (json) => {
      const box = await evaluate(`
        const el = document.querySelector('[data-widget="settings"] .monaco-editor .view-lines');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + 40), y: Math.round(r.y + 8) };`);
      if (box === null) throw new Error("no settings editor to type into");
      await mouse("mousePressed", box.x, box.y);
      await mouse("mouseReleased", box.x, box.y);
      // Typing before the editor has focus types into the window, which looks exactly like the
      // editor ignoring what was typed.
      await waitFor(
        `document.querySelector('[data-widget="settings"]').contains(document.activeElement)`,
        { label: "the settings editor has focus" },
      );
      await replaceDocument(json);
    };

    // ── Colours written in the settings reach both CSS and the canvas ──────
    // `ui.*` was the path that silently did nothing while the palette lived in a hand-written
    // stylesheet: the editor offered these keys and nothing could write them into CSS.
    const cssVar = (name) =>
      `getComputedStyle(document.documentElement).getPropertyValue("${name}").trim()`;
    await typeSettings(
      '{"theme": {"ui.background": "#123456", "grid.gridLine": "#654321"}, "themes": {"midnight": {"name": "Midnight", "extends": "dark", "colors": {"card": "#0a0b0c"}}}}',
    );
    await checkEventually(
      "an interface colour written in the settings reaches CSS",
      `${cssVar("--background")} === "#123456"`,
    );
    check(
      "and so does a canvas colour",
      (await evaluate(`return ${cssVar("--grid-line")};`)) === "#654321",
    );

    // A theme the workspace defined is offered beside the built-ins. `mod+alt+t` is the default
    // binding for the picker; the settings above do not rebind anything.
    await evaluate(`press("t", { metaKey: true, altKey: true });`);
    await waitFor(
      `document.querySelector('[data-testid="theme-picker"]') !== null`,
      { label: "the theme picker is open" },
    );
    const offeredThemes = await evaluate(
      `return [...document.querySelectorAll('[data-testid="theme-picker-navigator-list"] button')].map((b) => b.textContent.trim());`,
    );
    check(
      "a theme the workspace defines appears in the picker",
      offeredThemes.some((t) => t.includes("Midnight")),
      JSON.stringify(offeredThemes),
    );
    await evaluate(
      `document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));`,
    );
    await waitFor(
      `document.querySelector('[data-testid="theme-picker"]') === null`,
      { label: "the theme picker is closed" },
    );

    // ── The theme, all the way through ───────────────────────────────────────
    // One picture in a theme that is not the default, as a check that nothing is styled by
    // accident rather than by token: an unstyled component looks fine in dark and wrong here.
    await typeSettings('{"ui.theme": "terminal"}');
    await checkEventually(
      "`ui.theme` in the settings switches the theme",
      `document.documentElement.dataset.theme === "terminal"`,
    );
    await screenshot("terminal");
    const themed = await evaluate(`
      // The same two steps the application takes to resolve a colour for Monaco: this Chromium
      // serialises \`oklch\` verbatim, and painting it onto a canvas is what converts it.
      const probe = document.createElement("span");
      probe.style.display = "none";
      probe.style.backgroundColor = "var(--background)";
      document.body.appendChild(probe);
      const computed = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillStyle = computed;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      const editor = document.querySelector('[data-widget="settings"] .monaco-editor');
      return {
        ground: "rgb(" + r + ", " + g + ", " + b + ")",
        editorBackground: editor === null ? null : getComputedStyle(editor).backgroundColor,
      };`);
    check(
      "and the settings editor takes the theme's own ground rather than Monaco's",
      themed.editorBackground === themed.ground,
      JSON.stringify(themed),
    );

    await typeSettings(
      '{"grid.snap": 16, "keybindings": [{"key": "mod+b", "remove": true}]}',
    );
    await waitFor("window.pg.snapshot().config['grid.snap'] === 16", {
      label: "the setting is in force",
    });
    await idle();
    const written = JSON.parse(
      readFileSync(join(ws, "workspace.json"), "utf8"),
    );
    check(
      "the settings reached workspace.json",
      written.settings["grid.snap"] === 16,
      JSON.stringify(written.settings),
    );
    check("the file kept its name field", typeof written.name === "string");
    // The binding is gone, so the panel must NOT toggle. `idle` gives the keypress two frames to
    // have done something before the absence of a change means anything.
    await evaluate(`press("b", { metaKey: true });`);
    await idle();
    check(
      "removing a binding takes effect without a relaunch",
      (await evaluate(`return ${leftShown};`)) === true,
    );

    // And adding one does too, on the same read of the file.
    await typeSettings(
      '{"grid.snap": 16, "keybindings": [{"key": "mod+b", "remove": true}, {"key": "mod+alt+j", "command": "workbench.setTheme"}]}',
    );
    await waitFor("window.pg.snapshot().config.keybindings.length === 2", {
      label: "the new binding is in force",
    });
    // The document says which theme is on -- the stylesheet keys off it -- so that is what to read.
    const activeTheme = `document.documentElement.dataset.theme`;
    const themeBefore = await evaluate(`return ${activeTheme};`);
    await evaluate(`press("j", { metaKey: true, altKey: true });`);
    await checkEventually(
      "adding a binding takes effect without a relaunch",
      `document.querySelector('[data-testid="theme-picker"]') !== null`,
    );
    // Arrowing through the picker previews each theme, and escape puts back the one you had.
    // Twice: the list opens with the active theme first, so one press lands back on where you are.
    await evaluate(
      `const input = document.querySelector('[data-testid="theme-picker-navigator-search"]');
       input.focus();
       for (let i = 0; i < 2; i++) input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));`,
    );
    await checkEventually(
      "arrowing through the theme picker previews",
      `${activeTheme} !== ${JSON.stringify(themeBefore)}`,
    );
    await evaluate(
      `document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));`,
    );
    await checkEventually(
      "and escaping puts the old one back",
      `${activeTheme} === ${JSON.stringify(themeBefore)}`,
    );

    // Text that does not parse never reaches the file. The wait is for the editor to have noticed,
    // which is a thing that happens, rather than for the write that must not.
    await typeSettings('{"grid.snap": ');
    await waitFor("window.pg.stores.config.getState().parseError !== null", {
      label: "the editor reports the syntax error",
    });
    await idle();
    check(
      "text that does not parse is not written",
      JSON.parse(readFileSync(join(ws, "workspace.json"), "utf8")).settings[
        "grid.snap"
      ] === 16,
    );
    check(
      "and the editor says why",
      (await text()).toLowerCase().includes("json"),
    );

    // Back to the grid: the settings go away entirely, and the canvas, which saw a zero size while
    // its panel was hidden, is its panel's size again.
    await evaluate(`click('[role="tab"]', "Grid");`);
    await checkEventually(
      "switching back to the grid hides the settings entirely",
      `${settingsToolbarShown} === false`,
    );
    // Hidden, not thrown away: rebuilding the editor on every glance is what keeping it mounted
    // exists to avoid.
    check(
      "but keeps it built",
      (await evaluate(`return ${editorBuilt};`)) === true,
    );
    await checkEventually(
      "and the canvas fills its panel again",
      `(() => { const host = document.querySelector('[data-kb-scope="grid"]'); const c = host?.querySelector("canvas"); if (!c) return false; const r = c.getBoundingClientRect(); return r.width > 100 && Math.abs(r.width - host.clientWidth) <= 1 && Math.abs(r.height - host.clientHeight) <= 1; })()`,
    );

    const escaped = await evaluate(
      `return await window.workspace.writeProject("../escaped", "{}");`,
    );
    check(
      "a slug that climbs out of the workspace is refused",
      escaped?.ok === false,
      JSON.stringify(escaped),
    );
    check(
      "and nothing was written outside it",
      !existsSync(join(ws, "..", "escaped")),
    );
  },
};
