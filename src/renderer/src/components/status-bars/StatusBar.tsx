import { useConfigStore } from "@renderer/config/config-store";
import type { ReactNode } from "react";
import { statusBarRegistry } from "./status-bar-registry";
import type { StatusBarAlignment, StatusBarId, StatusBarLayout } from "./types";

export const CONFIG_KEY = "layout.statusBars";

/**
 * Reads the strip's contents out of the settings.
 *
 * Falls back to each item's own `defaultAlignment` for anything the file does not mention, so
 * registering a new status bar item makes it appear without anyone having to edit their settings —
 * and naming it in the file is how you move or reorder it.
 */
function itemsFor(
  alignment: StatusBarAlignment,
  layout: unknown,
): StatusBarId[] {
  const configured =
    layout !== null && typeof layout === "object" && !Array.isArray(layout)
      ? (layout as Record<string, unknown>)[alignment]
      : undefined;

  if (Array.isArray(configured))
    return configured.filter(
      (id): id is StatusBarId =>
        typeof id === "string" && statusBarRegistry.has(id),
    );

  return statusBarRegistry
    .all()
    .filter((item) => (item.defaultAlignment ?? "left") === alignment)
    .map((item) => item.id);
}

/** The strip along the bottom of the window. */
export const StatusBar = () => {
  const layout = useConfigStore((s) => s.computed[CONFIG_KEY]);

  const render = (alignment: StatusBarAlignment): ReactNode[] =>
    itemsFor(alignment, layout).flatMap((id, index) => {
      const item = statusBarRegistry.get(id);
      if (item === undefined) return [];
      const Component = item.component;
      return [
        // A divider between neighbours rather than around each item, so the ends of the strip sit
        // flush with the window.
        index > 0 ? (
          <span key={`sep-${id}`} className="select-none text-border">
            |
          </span>
        ) : null,
        <Component key={id} itemId={id} />,
      ];
    });

  return (
    <div className="flex h-6 w-full items-center justify-between gap-2 bg-background px-2 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-2">{render("left")}</div>
      <div className="flex min-w-0 items-center gap-2">{render("right")}</div>
    </div>
  );
};

export type { StatusBarLayout };
