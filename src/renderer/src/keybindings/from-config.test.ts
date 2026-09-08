import { describe, expect, it } from "vitest";
import { DEFAULT_KEYBINDINGS } from "./defaults";
import { bindingsFromConfig } from "./from-config";
import { KeybindingRegistry } from "./keybindings";

const anywhere = {
  focus: "none",
  modalOpen: false,
  hasSelection: false,
  engineReady: true,
};

function resolve(value: unknown, key: string): string | undefined {
  const registry = new KeybindingRegistry();
  const { bindings } = bindingsFromConfig(value as never);
  registry.setBindings(bindings);
  return registry.resolve(key, anywhere)?.command;
}

describe("keybindings from the settings", () => {
  it("keeps the defaults when the setting is absent", () => {
    const { bindings, error } = bindingsFromConfig(null);
    expect(error).toBeNull();
    expect(bindings).toEqual(DEFAULT_KEYBINDINGS);
  });

  it("adds a binding without disturbing the defaults", () => {
    expect(resolve([{ key: "mod+s", command: "project.save" }], "mod+s")).toBe(
      "project.save",
    );
    expect(resolve([{ key: "mod+s", command: "project.save" }], "mod+k")).toBe(
      "workbench.commandPalette",
    );
  });

  it("lets a user binding win over a default on the same key", () => {
    // The point of appending rather than replacing: a file says what it changed.
    expect(resolve([{ key: "mod+b", command: "project.save" }], "mod+b")).toBe(
      "project.save",
    );
  });

  it("takes a default away", () => {
    expect(
      resolve([{ key: "mod+b", command: "", remove: true }], "mod+b"),
    ).toBe(undefined);
  });

  it("takes one away and binds the key again in the same file", () => {
    expect(
      resolve(
        [
          { key: "mod+b", remove: true },
          { key: "mod+b", command: "view.resetLayout" },
        ],
        "mod+b",
      ),
    ).toBe("view.resetLayout");
  });

  it("removes only the named command when one is named", () => {
    expect(
      resolve(
        [
          { key: "mod+k", command: "workbench.cycleTheme" },
          { key: "mod+k", command: "workbench.cycleTheme", remove: true },
        ],
        "mod+k",
      ),
    ).toBe("workbench.commandPalette");
  });

  it("keeps the defaults and reports why when the value is malformed", () => {
    // A settings file that does not validate must not leave the application with no keyboard, because
    // the keyboard is how you reach the editor that would fix it.
    for (const bad of [
      "not a list",
      [{ command: "project.save" }],
      [{ key: "mod+s" }],
      [{ key: "mod+s", command: 7 }],
    ]) {
      const { bindings, error } = bindingsFromConfig(bad as never);
      expect(error).not.toBeNull();
      expect(bindings).toEqual(DEFAULT_KEYBINDINGS);
    }
  });

  it("carries a when clause and a scope through", () => {
    const registry = new KeybindingRegistry();
    registry.setBindings(
      bindingsFromConfig([
        {
          key: "delete",
          command: "patch.delete",
          scope: "grid",
          when: "hasSelection",
        },
      ] as never).bindings,
    );
    expect(
      registry.resolve("delete", {
        ...anywhere,
        focus: "grid",
        hasSelection: true,
      })?.command,
    ).toBe("patch.delete");
    expect(
      registry.resolve("delete", { ...anywhere, focus: "grid" }),
    ).toBeUndefined();
  });
});
