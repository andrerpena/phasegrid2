import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A project saved for the first time, the settings editor writing to the workspace and taking
 * effect without a relaunch, and the dock's panels being closed and put back.
 */
export default {
  name: "save-settings-dock",
  description:
    "save as, settings and keybindings live, themes, the dock, and the path guard",
  async run({
    workspace: ws,
    evaluate,
    text,
    screenshot,
    replaceDocument,
    mouse,
    sleep,
    check,
  }) {
    await evaluate(`click("button", "+");`);
    await sleep(400);
    await evaluate(
      `setValue(document.querySelector('input[aria-label="Tempo"]'), "137");`,
    );
    await sleep(300);
    check("the tab shows a dot once edited", (await text()).includes("•"));
    check(
      "the button offers Save As, having nowhere to save yet",
      (await text()).includes("Save As…"),
    );

    await evaluate(`click("button", "Save As…");`);
    await sleep(400);
    await evaluate(
      `setValue(document.querySelector("dialog input"), "My Track");`,
    );
    await sleep(250);
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
    await sleep(700);

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

    const session = JSON.parse(
      readFileSync(join(ws, ".phasegrid", "session.json"), "utf8"),
    );
    check(
      "the session records the open tab",
      session.open.includes("my-track") && session.active === "my-track",
      JSON.stringify(session),
    );

    // Settings, and a keybinding taking effect without a relaunch.
    await evaluate(`click('[role="tab"]', "Settings");`);
    await sleep(300);
    // The catalogue's own search field: present exactly when the left column is.
    const leftShown = `document.querySelector('[data-kb-scope="catalog"]') !== null`;
    const toggled = await evaluate(
      `press("b", { metaKey: true }); await new Promise(r => setTimeout(r, 250)); return ${leftShown};`,
    );
    check(
      "mod+b toggles the left panel by default",
      toggled === false,
      String(toggled),
    );
    await evaluate(`press("b", { metaKey: true });`);
    await sleep(300);
    check("and toggles it back", await evaluate(`return ${leftShown};`));

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
    await sleep(400);
    check(
      "closing a panel removes its tab",
      !(await tabNames()).includes("Performance"),
    );
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
    await sleep(400);
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
    await sleep(400);
    check(
      "and adding it back restores the tab",
      (await tabNames()).includes("Performance"),
    );
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
      await sleep(150);
      await replaceDocument(json);
    };

    // ── Colours written in the settings reach both CSS and the canvas ──────
    await typeSettings(
      '{"theme": {"ui.background": "#123456", "grid.gridLine": "#654321"}, "themes": {"midnight": {"name": "Midnight", "extends": "dark", "colors": {"card": "#0a0b0c"}}}}',
    );
    await sleep(600);
    const colours = await evaluate(`
      const read = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return { background: read("--background"), gridLine: read("--grid-line"), card: read("--card") };`);
    check(
      "an interface colour written in the settings reaches CSS",
      colours.background === "#123456",
      JSON.stringify(colours),
    );
    check(
      "and so does a canvas colour",
      colours.gridLine === "#654321",
      JSON.stringify(colours),
    );

    await evaluate(`press("t", { metaKey: true, altKey: true });`);
    await sleep(400);
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
    await sleep(250);

    // ── The theme, all the way through ───────────────────────────────────────
    await typeSettings('{"ui.theme": "terminal"}');
    await sleep(700);
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
        theme: document.documentElement.dataset.theme,
        ground: "rgb(" + r + ", " + g + ", " + b + ")",
        editorBackground: editor === null ? null : getComputedStyle(editor).backgroundColor,
      };`);
    check(
      "`ui.theme` in the settings switches the theme",
      themed.theme === "terminal",
      JSON.stringify(themed),
    );
    check(
      "and the settings editor takes the theme's own ground rather than Monaco's",
      themed.editorBackground === themed.ground,
      JSON.stringify(themed),
    );

    await typeSettings(
      '{"grid.snap": 16, "keybindings": [{"key": "mod+b", "remove": true}]}',
    );
    await sleep(600);
    const written = JSON.parse(
      readFileSync(join(ws, "workspace.json"), "utf8"),
    );
    check(
      "the settings reached workspace.json",
      written.settings["grid.snap"] === 16,
      JSON.stringify(written.settings),
    );
    check("the file kept its name field", typeof written.name === "string");
    const stillThere = await evaluate(
      `press("b", { metaKey: true }); await new Promise(r => setTimeout(r, 250)); return ${leftShown};`,
    );
    check(
      "removing a binding takes effect without a relaunch",
      stillThere === true,
      String(stillThere),
    );

    await typeSettings(
      '{"grid.snap": 16, "keybindings": [{"key": "mod+b", "remove": true}, {"key": "mod+alt+j", "command": "workbench.setTheme"}]}',
    );
    await sleep(500);
    const activeTheme = `document.documentElement.dataset.theme`;
    const themeBefore = await evaluate(`return ${activeTheme};`);
    await evaluate(`press("j", { metaKey: true, altKey: true });`);
    await sleep(400);
    check(
      "adding a binding takes effect without a relaunch",
      (await evaluate(
        `return document.querySelector('[data-testid="theme-picker"]') !== null;`,
      )) === true,
      "the theme picker did not open",
    );
    // Arrowing through the picker previews each theme, and escape puts back the one you had.
    await evaluate(
      `const input = document.querySelector('[data-testid="theme-picker-navigator-search"]');
       input.focus();
       for (let i = 0; i < 2; i++) input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));`,
    );
    await sleep(250);
    const themePreviewed = await evaluate(`return ${activeTheme};`);
    check(
      "arrowing through the theme picker previews",
      themePreviewed !== themeBefore,
      `${themeBefore} -> ${themePreviewed}`,
    );
    await evaluate(
      `document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));`,
    );
    await sleep(250);
    check(
      "and escaping puts the old one back",
      (await evaluate(`return ${activeTheme};`)) === themeBefore,
    );

    // Text that does not parse never reaches the file.
    await typeSettings('{"grid.snap": ');
    await sleep(500);
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
