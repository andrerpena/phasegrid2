import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { keptPanels, Tabs } from "./Tabs";
import type { TabItem } from "./types";

/**
 * What a kept-mounted tab strip builds, and how it hides what is not in front.
 *
 * Two bugs live here. A panel nobody had opened was built anyway, which defeated the dynamic
 * import that keeps a five-megabyte editor out of every launch. And what was not in front was
 * hidden with `visibility: hidden`, which a descendant can override -- the settings panel's own
 * inner strip did, with a `visible` on its active panel, so its toolbar and editor painted over
 * the grid while the Grid tab was the selected one.
 */
const tab = (id: string, content: React.ReactNode): TabItem => ({
  id,
  label: id,
  content,
});

const TABS = [
  tab("grid", <canvas />),
  tab("settings", <button type="button">Reset</button>),
];

describe("which panels a kept-mounted strip builds", () => {
  it("builds only what has been in front", () => {
    expect(
      keptPanels(TABS, "grid", new Set(["grid"])).map((p) => p.tab.id),
    ).toEqual(["grid"]);
  });

  it("keeps one it has built, hidden, once it is no longer in front", () => {
    // The whole point of keeping panels mounted: a canvas and an editor are expensive to rebuild.
    expect(keptPanels(TABS, "grid", new Set(["grid", "settings"]))).toEqual([
      { tab: TABS[0], hidden: false },
      { tab: TABS[1], hidden: true },
    ]);
  });

  it("never hides the one in front", () => {
    expect(
      keptPanels(TABS, "settings", new Set(["grid", "settings"])).find(
        (p) => p.tab.id === "settings",
      )?.hidden,
    ).toBe(false);
  });
});

/** The opening tag of the tabpanel with this id, or null when it was not built at all. */
function panelTag(html: string, id: string): string | null {
  const at = html.indexOf(`id="tabpanel-${id}"`);
  if (at < 0) return null;
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
}

const classTokens = (tag: string): string[] =>
  (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/);

describe("a kept-mounted strip on its first render", () => {
  const html = renderToStaticMarkup(
    <Tabs
      tabs={[
        tab("grid", <canvas />),
        tab(
          "settings",
          <Tabs
            tabs={[
              tab("overrides", <button type="button">Reset</button>),
              tab("defaults", <p>defaults</p>),
            ]}
            activeTabId="overrides"
            keepMounted
          />,
        ),
      ]}
      activeTabId="grid"
      keepMounted
    />,
  );

  it("builds the panel in front", () => {
    expect(html).toContain("<canvas");
    expect(panelTag(html, "grid")).not.toBeNull();
  });

  it("does not build one nobody has opened", () => {
    // The editor behind the Settings tab is fetched by a dynamic import when it is first rendered.
    // Rendering it here is what made every launch pay for it.
    expect(panelTag(html, "settings")).toBeNull();
    expect(html).not.toContain("Reset");
  });

  it("declares no visibility on the panel it did build", () => {
    // `visible` and `invisible` are the Tailwind names for the property that leaked through.
    const tokens = classTokens(panelTag(html, "grid") ?? "");
    expect(tokens).not.toContain("visible");
    expect(tokens).not.toContain("invisible");
  });
});
