import { useConfigStore } from "@renderer/config/config-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetDefinition, WidgetId, WidgetSlotId } from "./types";
import {
  CONFIG_KEY,
  canAddWidgetToSlot,
  canRemoveWidget,
  refreshWidgetLayout,
  useWidgetLayoutStore,
} from "./widget-layout-store";
import { widgetRegistry } from "./widget-registry";

/** A registry of stand-ins, so these tests describe the rules rather than the current panel set. */
function define(
  id: string,
  extra: Partial<WidgetDefinition> = {},
): WidgetDefinition {
  return {
    id: id as WidgetId,
    label: id,
    component: () => null,
    ...extra,
  };
}

function setLayout(layout: Partial<Record<WidgetSlotId, string[]>>): void {
  useConfigStore.setState({
    computed: { ...useConfigStore.getState().computed, [CONFIG_KEY]: layout },
  });
  refreshWidgetLayout();
}

const layout = () => useWidgetLayoutStore.getState().layout;

beforeEach(() => {
  // Persisting a layout writes the workspace's settings file; these tests are about the rules, not
  // about the disk, so the write is stubbed rather than the store being made to skip it.
  vi.stubGlobal("window", {
    workspace: {
      readSettings: async () => ({ ok: true, value: null }),
      writeSettings: async () => ({ ok: true, value: undefined }),
    },
  });
  widgetRegistry.clear();
  widgetRegistry.register(define("plain"));
  widgetRegistry.register(
    define("wide-one", {
      size: "wide",
      defaultSlot: "center",
    }),
  );
  widgetRegistry.register(
    define("pinned-one", {
      placement: { pinned: true },
      defaultSlot: "center",
    }),
  );
  widgetRegistry.register(
    define("unique-one", {
      placement: { unique: true },
      defaultSlot: "right-top",
    }),
  );
  widgetRegistry.register(
    define("sidebar-only", { placement: { allowedSlots: ["left-top"] } }),
  );
  useConfigStore.setState({ overrides: {} });
});

describe("what may go where", () => {
  it("lets an ordinary widget into any slot", () => {
    expect(canAddWidgetToSlot("plain", "left-top")).toBe(true);
    expect(canAddWidgetToSlot("plain", "center")).toBe(true);
  });

  it("keeps a wide widget out of the sidebars", () => {
    expect(canAddWidgetToSlot("wide-one", "center")).toBe(true);
    expect(canAddWidgetToSlot("wide-one", "center-bottom")).toBe(true);
    expect(canAddWidgetToSlot("wide-one", "left-top")).toBe(false);
    expect(canAddWidgetToSlot("wide-one", "right-bottom")).toBe(false);
  });

  it("honours an explicit whitelist", () => {
    expect(canAddWidgetToSlot("sidebar-only", "left-top")).toBe(true);
    expect(canAddWidgetToSlot("sidebar-only", "left-bottom")).toBe(false);
  });

  it("refuses a widget this build does not have", () => {
    expect(canAddWidgetToSlot("nonesuch", "left-top")).toBe(false);
  });

  it("will not close a pinned widget", () => {
    expect(canRemoveWidget("pinned-one")).toBe(false);
    expect(canRemoveWidget("plain")).toBe(true);
  });
});

describe("reading a layout out of the settings", () => {
  it("takes the slots it recognises", () => {
    setLayout({ "left-top": ["plain"], "right-top": ["unique-one"] });
    expect(layout()["left-top"]).toEqual(["plain"]);
    expect(layout()["right-top"]).toEqual(["unique-one"]);
  });

  it("drops a name no widget answers to", () => {
    setLayout({ "left-top": ["plain", "nonesuch"] });
    expect(layout()["left-top"]).toEqual(["plain"]);
  });

  it("drops a duplicate within a slot", () => {
    setLayout({ "left-top": ["plain", "plain"] });
    expect(layout()["left-top"]).toEqual(["plain"]);
  });

  it("ignores a slot that is not a list, and a layout that is not an object", () => {
    setLayout({ "left-top": "plain" as unknown as string[] });
    expect(layout()["left-top"]).toEqual([]);
    useConfigStore.setState({
      computed: { ...useConfigStore.getState().computed, [CONFIG_KEY]: 7 },
    });
    refreshWidgetLayout();
    expect(layout()["left-top"]).toEqual([]);
  });

  it("puts a pinned widget back when the file has lost it", () => {
    // The case that matters: a settings file with no grid in it must still open a window with a
    // grid, because nothing in the interface could put it back.
    setLayout({ "left-top": ["plain"] });
    expect(layout().center).toEqual(["pinned-one"]);
  });

  it("keeps only one copy of a unique widget", () => {
    setLayout({ "right-top": ["unique-one"], "left-top": ["unique-one"] });
    const slots = Object.entries(layout()).filter(([, ids]) =>
      ids.includes("unique-one" as WidgetId),
    );
    expect(slots).toHaveLength(1);
    // Its own slot wins over the one that merely came first.
    expect(slots[0]?.[0]).toBe("right-top");
  });
});

describe("moving panels around", () => {
  beforeEach(() => {
    setLayout({ "left-top": ["plain"], center: ["wide-one", "pinned-one"] });
  });

  it("adds and persists", () => {
    expect(
      useWidgetLayoutStore
        .getState()
        .addWidgetToSlot("sidebar-only" as WidgetId, "left-top"),
    ).toBe(true);
    expect(layout()["left-top"]).toEqual(["plain", "sidebar-only"]);
    expect(useConfigStore.getState().overrides[CONFIG_KEY]).toBeDefined();
  });

  it("refuses to add where placement forbids", () => {
    expect(
      useWidgetLayoutStore
        .getState()
        .addWidgetToSlot("wide-one" as WidgetId, "left-top"),
    ).toBe(false);
    expect(layout()["left-top"]).toEqual(["plain"]);
  });

  it("removes from wherever it was", () => {
    expect(
      useWidgetLayoutStore.getState().removeWidget("plain" as WidgetId),
    ).toBe(true);
    expect(layout()["left-top"]).toEqual([]);
  });

  it("will not remove a pinned widget", () => {
    expect(
      useWidgetLayoutStore.getState().removeWidget("pinned-one" as WidgetId),
    ).toBe(false);
    expect(layout().center).toContain("pinned-one");
  });

  it("moves rather than copies", () => {
    expect(
      useWidgetLayoutStore
        .getState()
        .moveWidget("plain" as WidgetId, "right-bottom"),
    ).toBe(true);
    expect(layout()["left-top"]).toEqual([]);
    expect(layout()["right-bottom"]).toEqual(["plain"]);
  });

  it("will not move a pinned widget out of its slot", () => {
    expect(
      useWidgetLayoutStore
        .getState()
        .moveWidget("pinned-one" as WidgetId, "center-bottom"),
    ).toBe(false);
    expect(layout().center).toContain("pinned-one");
  });
});
