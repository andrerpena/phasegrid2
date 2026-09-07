import { describe, expect, it } from "vitest";
import {
  type NavigatorItem,
  rankNavigatorItems,
} from "./SearchableTreeNavigator";

const items: NavigatorItem[] = [
  {
    id: "patch.addModule",
    label: "Add Module",
    hint: "patch.addModule",
    group: "Patch",
  },
  { id: "edit.undo", label: "Undo", hint: "edit.undo", group: "Edit" },
  { id: "edit.redo", label: "Redo", hint: "edit.redo", group: "Edit" },
  {
    id: "view.zoomToFit",
    label: "Zoom to Fit",
    hint: "view.zoomToFit",
    group: "View",
  },
  {
    id: "osc.wavetable",
    label: "Wavetable Oscillator",
    hint: "osc.wavetable",
    keywords: "osc",
  },
];

const labels = (query: string) =>
  rankNavigatorItems(items, query).map((i) => i.label);

describe("ranking in the navigator", () => {
  it("keeps everything, in order, when nothing is typed", () => {
    expect(labels("")).toEqual(items.map((i) => i.label));
  });

  it("matches letters in order rather than as a substring", () => {
    expect(labels("adm")[0]).toBe("Add Module");
    expect(labels("ztf")[0]).toBe("Zoom to Fit");
  });

  it("prefers a match that starts a word", () => {
    expect(labels("mod")[0]).toBe("Add Module");
  });

  it("searches the hint as well as the label", () => {
    // Someone who knows the id types the id.
    expect(labels("osc.wave")[0]).toBe("Wavetable Oscillator");
  });

  it("searches the keywords", () => {
    expect(labels("osc")).toContain("Wavetable Oscillator");
  });

  it("drops what does not match at all", () => {
    expect(labels("zzzz")).toEqual([]);
  });

  it("ignores case and surrounding space", () => {
    expect(labels("  ADD MODULE ")[0]).toBe("Add Module");
  });

  it("is stable for two items that score the same", () => {
    // Undo and Redo both match "do"; the order has to be decided rather than incidental.
    const twice = [labels("do"), labels("do")];
    expect(twice[0]).toEqual(twice[1]);
  });
});

describe("weighting the fields", () => {
  const examples: NavigatorItem[] = [
    {
      id: "example.osc.wavetable",
      label: "Example: Wavetable Oscillator",
      hint: "example.osc.wavetable",
      keywords: "An oscillator on its own, at middle C. Turn Level for volume.",
    },
    {
      id: "example.fx.flanger",
      label: "Example: Flanger",
      hint: "example.fx.flanger",
      keywords: "Flanger on a bare tone. Turn Feedback for the sweep to bite.",
    },
    {
      id: "example.fx.reverb",
      label: "Example: Reverb",
      hint: "example.fx.reverb",
      keywords:
        "Reverb on a bare tone. Turn Dry/Wet, then Decay Time and Size.",
    },
  ];

  it("puts a name match above a description match", () => {
    // Two or three letters can be found scattered through almost any sentence, so an unweighted
    // description match drowns the labels: typing "os" put the flanger above the oscillator.
    expect(rankNavigatorItems(examples, "os")[0].id).toBe(
      "example.osc.wavetable",
    );
  });

  it("still finds something by what its description says", () => {
    // Keywords earn their place: they are how you find a thing by what it does rather than its name.
    expect(rankNavigatorItems(examples, "sweep").map((i) => i.id)).toContain(
      "example.fx.flanger",
    );
  });

  it("ranks an exact name first even when others mention the word", () => {
    expect(rankNavigatorItems(examples, "reverb")[0].id).toBe(
      "example.fx.reverb",
    );
  });
});
