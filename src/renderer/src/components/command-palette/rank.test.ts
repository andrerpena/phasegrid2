import { describe, expect, it } from "vitest";
import type { MenuItem } from "../../menu/types";
import { flattenForSearch, rankMenuItems } from "./rank";

const items: MenuItem[] = [
  { id: "patch.addModule", label: "Add Module", subtitle: "patch.addModule" },
  { id: "edit.undo", label: "Undo", subtitle: "edit.undo" },
  { id: "edit.redo", label: "Redo", subtitle: "edit.redo" },
  { id: "view.zoomToFit", label: "Zoom to Fit", subtitle: "view.zoomToFit" },
  {
    id: "osc.wavetable",
    label: "Wavetable Oscillator",
    subtitle: "osc.wavetable",
    keywords: "osc",
  },
];

const labels = (query: string) =>
  rankMenuItems(items, query).map((i) => i.label);

describe("ranking in the navigator", () => {
  it("keeps everything, in order, when nothing is typed", () => {
    expect(labels("")).toEqual(items.map((i) => i.label));
  });

  it("matches letters in order rather than as a substring", () => {
    expect(labels("adm")[0]).toBe("Add Module");
    expect(labels("ztf")[0]).toBe("Zoom to Fit");
  });

  it("drops what does not match at all", () => {
    expect(labels("qqq")).toEqual([]);
  });

  it("finds a command by its id", () => {
    expect(labels("editun")[0]).toBe("Undo");
  });

  it("prefers a word boundary to a letter in the middle", () => {
    // "wo" is a boundary hit in "WavetableOscillator"'s subtitle and a mid-word one elsewhere.
    expect(labels("zoom")[0]).toBe("Zoom to Fit");
  });

  it("keeps a name match above a description match", () => {
    // "osc" is this module's whole keyword set, and is also a subsequence of several labels.
    // A keyword hit must never outrank the thing actually called that.
    const withDecoy: MenuItem[] = [
      ...items,
      { id: "fx.flanger", label: "Flanger", keywords: "an oscillating comb" },
    ];
    expect(rankMenuItems(withDecoy, "osc")[0]?.label).toBe(
      "Wavetable Oscillator",
    );
  });
});

describe("flattening for search", () => {
  const tree: MenuItem[] = [
    {
      id: "fx",
      label: "FX",
      children: [
        { id: "fx.delay", label: "Delay" },
        { id: "fx.chorus", label: "Chorus" },
      ],
    },
    { id: "amp.vca", label: "VCA" },
  ];

  it("reaches an item under a collapsed parent", () => {
    expect(flattenForSearch(tree).map((i) => i.id)).toEqual([
      "fx",
      "fx.delay",
      "fx.chorus",
      "amp.vca",
    ]);
  });

  it("drops the children from the parent it kept, so nothing is listed twice", () => {
    expect(flattenForSearch(tree)[0]?.children).toBeUndefined();
  });
});
