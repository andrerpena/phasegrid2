import { describe, expect, it } from "vitest";
import {
  eventToKey,
  type KeybindingContext,
  KeybindingRegistry,
} from "./keybindings";

const inGrid: KeybindingContext = {
  focus: "grid",
  modalOpen: false,
  hasSelection: true,
  engineReady: true,
};

function keyEvent(
  init: Partial<KeyboardEvent> & { key: string },
): KeyboardEvent {
  return {
    key: init.key,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
  } as KeyboardEvent;
}

describe("turning a keystroke into a name", () => {
  it("calls the platform's primary modifier `mod` so one file suits both", () => {
    expect(eventToKey(keyEvent({ key: "z", metaKey: true }), true)).toBe(
      "mod+z",
    );
    expect(eventToKey(keyEvent({ key: "z", ctrlKey: true }), false)).toBe(
      "mod+z",
    );
  });

  it("keeps the other modifier distinguishable", () => {
    // On an Apple keyboard, control is not `mod`. Dropping it would make ctrl+z read as plain z.
    expect(eventToKey(keyEvent({ key: "z", ctrlKey: true }), true)).toBe(
      "ctrl+z",
    );
  });

  it("orders modifiers the same way every time", () => {
    expect(
      eventToKey(
        keyEvent({ key: "f", metaKey: true, altKey: true, shiftKey: true }),
        true,
      ),
    ).toBe("mod+alt+shift+f");
  });

  it("names the keys that have no character", () => {
    expect(eventToKey(keyEvent({ key: "Escape" }), true)).toBe("escape");
    expect(eventToKey(keyEvent({ key: " " }), true)).toBe("space");
  });
});

describe("resolving a keystroke to a command", () => {
  it("finds a plain binding", () => {
    const r = new KeybindingRegistry();
    r.setBindings([{ key: "mod+z", command: "edit.undo" }]);
    expect(r.resolve("mod+z", inGrid)?.command).toBe("edit.undo");
  });

  it("ignores a binding whose scope is not focused", () => {
    const r = new KeybindingRegistry();
    r.setBindings([
      { key: "delete", command: "patch.deleteSelection", scope: "grid" },
    ]);
    expect(r.resolve("delete", inGrid)?.command).toBe("patch.deleteSelection");
    expect(
      r.resolve("delete", { ...inGrid, focus: "inspector" }),
    ).toBeUndefined();
  });

  it("ignores a binding whose condition is false", () => {
    const r = new KeybindingRegistry();
    r.setBindings([
      { key: "delete", command: "patch.deleteSelection", when: "hasSelection" },
    ]);
    expect(
      r.resolve("delete", { ...inGrid, hasSelection: false }),
    ).toBeUndefined();
  });

  it("lets a scoped binding beat an unscoped one", () => {
    // So a widget can override a global shortcut without knowing what the global one does. Without
    // this rule the only way to override would be to remove the global binding, which a user's file
    // cannot do.
    const r = new KeybindingRegistry();
    r.setBindings([
      { key: "mod+a", command: "select.all", scope: "grid" },
      { key: "mod+a", command: "text.selectAll" },
    ]);
    expect(r.resolve("mod+a", inGrid)?.command).toBe("select.all");
  });

  it("lets the last registered win among equals", () => {
    // Defaults load first and the user's file loads on top, so this is how overriding works at all.
    const r = new KeybindingRegistry();
    r.setBindings([
      { key: "mod+s", command: "project.save" },
      { key: "mod+s", command: "project.saveAs" },
    ]);
    expect(r.resolve("mod+s", inGrid)?.command).toBe("project.saveAs");
  });

  it("treats a broken condition as never matching, not as always matching", () => {
    // The dangerous failure is a clause that cannot be read being treated as "no restriction", which
    // would fire a destructive command in contexts its author excluded.
    const r = new KeybindingRegistry();
    r.setBindings([
      {
        key: "delete",
        command: "patch.deleteSelection",
        when: "hasSelection &&",
      },
    ]);
    expect(r.resolve("delete", inGrid)).toBeUndefined();
  });

  it("returns nothing for a key nobody bound", () => {
    const r = new KeybindingRegistry();
    r.setBindings([{ key: "mod+z", command: "edit.undo" }]);
    expect(r.resolve("mod+y", inGrid)).toBeUndefined();
  });

  it("carries a payload through", () => {
    const r = new KeybindingRegistry();
    r.setBindings([
      { key: "mod+1", command: "view.setZoom", payload: { scale: 1 } },
    ]);
    expect(r.resolve("mod+1", inGrid)?.payload).toEqual({ scale: 1 });
  });
});
