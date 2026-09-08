import { describe, expect, it } from "vitest";
import { applyTheme } from "./apply-theme";
import { dark, light, terminal } from "./themes";

/** A stand-in for the document element, so these tests need no browser. */
function fakeRoot(): HTMLElement {
  return {
    style: { colorScheme: "" },
    dataset: {} as Record<string, string>,
  } as unknown as HTMLElement;
}

describe("applying a theme", () => {
  it("names the theme on the element", () => {
    const root = fakeRoot();
    applyTheme(dark, root);
    expect(root.dataset.theme).toBe("dark");
    applyTheme(terminal, root);
    expect(root.dataset.theme).toBe("terminal");
  });

  it("follows the theme's lightness, not its name", () => {
    const root = fakeRoot();
    applyTheme(light, root);
    expect(root.style.colorScheme).toBe("light");
    // Terminal is a dark theme whose name says nothing about it, which is the case that catches a
    // `colorScheme` derived from the id instead of from `type`.
    applyTheme(terminal, root);
    expect(root.style.colorScheme).toBe("dark");
  });
});
