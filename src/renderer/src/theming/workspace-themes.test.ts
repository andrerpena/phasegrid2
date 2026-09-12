import { useConfigStore } from "@renderer/config/config-store";
import type { ConfigRecord } from "@shared/protocol/storage";
import { describe, expect, it } from "vitest";
import { dark, light, THEMES } from "./themes";
import { resolveThemes, WorkspaceThemeSchema } from "./workspace-themes";

const defaults = (): ConfigRecord => ({
  ...useConfigStore.getState().defaults,
});

function withSettings(over: ConfigRecord) {
  return resolveThemes({ ...defaults(), ...over });
}

const byId = (themes: ReturnType<typeof resolveThemes>, id: string) =>
  themes.find((t) => t.id === id);

describe("the themes a workspace can define", () => {
  it("is just the built-ins when it defines none", () => {
    expect(resolveThemes(defaults())).toEqual(THEMES);
  });

  it("adds a new theme, inheriting everything it does not mention", () => {
    const themes = withSettings({
      themes: {
        midnight: { name: "Midnight", colors: { background: "#010203" } },
      },
    });
    const midnight = byId(themes, "midnight");
    expect(midnight?.name).toBe("Midnight");
    expect(midnight?.colors.background).toBe("#010203");
    // Everything else is the theme it extends -- which defaults to dark.
    expect(midnight?.colors.foreground).toBe(dark.colors.foreground);
    expect(midnight?.grid.signal.audio).toBe(dark.grid.signal.audio);
    expect(midnight?.type).toBe("dark");
  });

  it("extends the theme it is told to", () => {
    const themes = withSettings({
      themes: { paper: { extends: "light", colors: { card: "#fefefe" } } },
    });
    const paper = byId(themes, "paper");
    expect(paper?.colors.card).toBe("#fefefe");
    expect(paper?.colors.background).toBe(light.colors.background);
    expect(paper?.type).toBe("light");
  });

  it("replaces a built-in when it takes its id", () => {
    // "I want dark, but a bit different" is the obvious thing to want, and the alternative is
    // making people invent a second name for it.
    const themes = withSettings({
      themes: { dark: { colors: { background: "#000000" } } },
    });
    expect(themes.filter((t) => t.id === "dark")).toHaveLength(1);
    expect(byId(themes, "dark")?.colors.background).toBe("#000000");
    expect(themes).toHaveLength(THEMES.length);
  });

  it("names itself after its id when it gives no name", () => {
    expect(byId(withSettings({ themes: { plain: {} } }), "plain")?.name).toBe(
      "plain",
    );
  });

  it("overrides a nested signal role without losing the others", () => {
    const themes = withSettings({
      themes: { loud: { grid: { signal: { audio: "#ff0000" } } } },
    });
    const loud = byId(themes, "loud");
    expect(loud?.grid.signal.audio).toBe("#ff0000");
    expect(loud?.grid.signal.gate).toBe(dark.grid.signal.gate);
  });

  it("drops a canvas colour the canvas cannot read", () => {
    // `hexToNumber` parses `#rrggbb` and nothing else, so an `oklch` grid colour would draw black.
    const themes = withSettings({
      themes: { odd: { grid: { gridLine: "oklch(0.5 0 0)" } } },
    });
    expect(byId(themes, "odd")?.grid.gridLine).toBe(dark.grid.gridLine);
  });

  it("keeps the other themes when one does not validate", () => {
    // One malformed entry should cost that entry, not every theme in the file.
    const themes = withSettings({
      themes: { broken: { colors: { nonesuch: "#fff" } } },
    });
    expect(themes).toEqual(THEMES);
  });

  it("survives a `themes` key that is not an object", () => {
    expect(withSettings({ themes: "dark" })).toEqual(THEMES);
    expect(withSettings({ themes: [] as never })).toEqual(THEMES);
  });
});

describe("the flat colour overrides", () => {
  it("reaches an interface colour, which is what CSS reads", () => {
    // This is the one that silently did nothing while the palette lived in a stylesheet: the
    // settings editor offered `ui.*` paths and nothing could write them into CSS.
    const themes = withSettings({
      theme: { "ui.background": "oklch(0.2 0 0)" },
    });
    expect(byId(themes, "dark")?.colors.background).toBe("oklch(0.2 0 0)");
  });

  it("reaches a canvas colour and a signal role", () => {
    const themes = withSettings({
      theme: { "grid.gridLine": "#202430", "signal.audio": "#ff5c5c" },
    });
    expect(byId(themes, "dark")?.grid.gridLine).toBe("#202430");
    expect(byId(themes, "dark")?.grid.signal.audio).toBe("#ff5c5c");
  });

  it("applies to every theme, so the generated stylesheet is right whichever is active", () => {
    const themes = withSettings({ theme: { "ui.ring": "#abcdef" } });
    for (const theme of themes) expect(theme.colors.ring).toBe("#abcdef");
  });

  it("lands on top of a workspace theme", () => {
    const themes = withSettings({
      themes: { midnight: { colors: { background: "#010203" } } },
      theme: { "ui.background": "#040506" },
    });
    expect(byId(themes, "midnight")?.colors.background).toBe("#040506");
  });

  it("ignores what it does not recognise", () => {
    const themes = withSettings({
      theme: {
        "ui.nonesuch": "#ff0000",
        "grid.nonesuch": "#ff0000",
        "signal.smell": "#ff0000",
        // A canvas colour the canvas cannot parse.
        "grid.nodeFill": "oklch(0.5 0 0)",
      },
    });
    const resolved = byId(themes, "dark");
    expect(resolved?.grid.nodeFill).toBe(dark.grid.nodeFill);
    expect(Object.keys(resolved?.colors ?? {})).not.toContain("nonesuch");
    expect(Object.keys(resolved?.grid.signal ?? {})).not.toContain("smell");
  });

  it("survives a `theme` key that is not a record of strings", () => {
    expect(withSettings({ theme: "dark" })).toEqual(THEMES);
    expect(withSettings({ theme: { "ui.background": 7 } as never })).toEqual(
      THEMES,
    );
  });
});

describe("the schema the settings editor validates against", () => {
  it("takes a partial theme", () => {
    expect(
      WorkspaceThemeSchema.safeParse({
        name: "X",
        colors: { background: "#000" },
      }).success,
    ).toBe(true);
  });

  it("refuses a colour name that is not one", () => {
    expect(
      WorkspaceThemeSchema.safeParse({ colors: { backgroundd: "#000" } })
        .success,
    ).toBe(false);
  });

  it("refuses a top-level key that is not one", () => {
    expect(
      WorkspaceThemeSchema.safeParse({ colours: { background: "#000" } })
        .success,
    ).toBe(false);
  });

  it("refuses a type that is neither light nor dark", () => {
    expect(WorkspaceThemeSchema.safeParse({ type: "beige" }).success).toBe(
      false,
    );
  });
});
