import { describe, expect, it } from "vitest";
import { applyTheme, themeCustomProperties } from "./apply-theme";
import { dark, light, THEMES, themeById } from "./themes";

/** A stand-in for the document element, so these tests need no browser. */
function fakeRoot(): HTMLElement {
  const props = new Map<string, string>();
  return {
    style: {
      setProperty: (k: string, v: string) => props.set(k, v),
      getPropertyValue: (k: string) => props.get(k) ?? "",
      colorScheme: "",
    },
    dataset: {} as Record<string, string>,
  } as unknown as HTMLElement;
}

describe("applying a theme", () => {
  it("writes every colour as a custom property", () => {
    const root = fakeRoot();
    applyTheme(dark, root);
    for (const name of themeCustomProperties(dark)) {
      expect(root.style.getPropertyValue(name), name).not.toBe("");
    }
  });

  it("converts a camel-cased name to a kebab-cased property", () => {
    const root = fakeRoot();
    applyTheme(dark, root);
    expect(root.style.getPropertyValue("--color-card-foreground")).toBe(
      dark.colors.cardForeground,
    );
  });

  it("exposes the signal colours the canvas draws with", () => {
    // The canvas cannot read a CSS variable and a stylesheet cannot read the theme object, so both have
    // to come from one value. A port drawn green on the canvas and shown grey in a panel is exactly the
    // bug this prevents.
    const root = fakeRoot();
    applyTheme(dark, root);
    expect(root.style.getPropertyValue("--color-signal-note")).toBe(
      dark.grid.signal.note,
    );
    expect(root.style.getPropertyValue("--color-signal-gate")).toBe(
      dark.grid.signal.gate,
    );
  });

  it("marks which theme is active, for the rules a colour swap cannot express", () => {
    const root = fakeRoot();
    applyTheme(light, root);
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });
});

describe("the theme registry", () => {
  it("falls back rather than throwing on a theme this build does not have", () => {
    // A config naming a theme that was removed should open in the default, not refuse to start.
    expect(themeById("no-such-theme").id).toBe(dark.id);
  });

  it("gives every theme the same set of colours", () => {
    // A theme missing a colour would leave the previous theme's value on the document, because setting
    // properties never clears the ones it does not mention.
    const expected = themeCustomProperties(dark).sort();
    for (const theme of THEMES) {
      expect(themeCustomProperties(theme).sort(), theme.id).toEqual(expected);
    }
  });

  it("gives every theme a colour for every signal role the engine declares", () => {
    // These mirror SignalRole in the engine. A role added there without one here would draw as
    // undefined, which Pixi renders as black and a person reads as "broken".
    const roles = ["any", "audio", "cv", "gate", "pitch", "phase", "note"];
    for (const theme of THEMES) {
      expect(Object.keys(theme.grid.signal).sort(), theme.id).toEqual(
        [...roles].sort(),
      );
    }
  });
});
