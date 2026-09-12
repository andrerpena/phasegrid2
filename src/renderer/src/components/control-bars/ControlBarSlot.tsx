import { useConfigStore } from "@renderer/config/config-store";
import { controlBarRegistry } from "./control-bar-registry";
import type { ControlBarId, ControlBarPosition } from "./types";

export const CONFIG_KEY = "layout.controlBars";

const positionClasses: Record<ControlBarPosition, string> = {
  "left-top": "top-2 left-2",
  "left-bottom": "bottom-2 left-2",
  "right-top": "top-2 right-2",
  "right-bottom": "bottom-2 right-2",
};

/**
 * The controls that float in a corner of the canvas.
 *
 * `pointer-events-none` on the container and back on for each bar, so the space around a control is
 * still canvas: a corner reserved for a small button should not be a corner you cannot drag through.
 */
export const ControlBarSlot = ({
  position,
}: {
  position: ControlBarPosition;
}) => {
  const layout = useConfigStore((s) => s.computed[CONFIG_KEY]);

  const configured =
    layout !== null && typeof layout === "object" && !Array.isArray(layout)
      ? (layout as Record<string, unknown>)[position]
      : undefined;

  const ids: ControlBarId[] = Array.isArray(configured)
    ? configured.filter(
        (id): id is ControlBarId =>
          typeof id === "string" && controlBarRegistry.has(id),
      )
    : controlBarRegistry
        .all()
        .filter((bar) => (bar.defaultPosition ?? "right-top") === position)
        .map((bar) => bar.id);

  if (ids.length === 0) return null;

  return (
    <div
      className={`pointer-events-none absolute z-10 flex flex-row gap-2 ${positionClasses[position]}`}
    >
      {ids.map((id) => {
        const bar = controlBarRegistry.get(id);
        if (bar === undefined) return null;
        return (
          <div key={id} className="pointer-events-auto">
            <bar.component barId={id} position={position} />
          </div>
        );
      })}
    </div>
  );
};
