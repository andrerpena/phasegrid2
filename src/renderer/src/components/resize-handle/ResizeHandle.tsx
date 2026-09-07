import { useCallback, useEffect, useRef } from "react";
import styles from "./ResizeHandle.module.css";

export interface ResizeHandleProps {
  orientation: "vertical" | "horizontal";
  /** Called with the pointer position as a fraction of `containerSize`, already clamped by the store. */
  onResize: (ratio: number) => void;
  /** The element the ratio is measured against. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Measured from the far edge instead of the near one, for a panel on the right or the bottom. */
  fromEnd?: boolean;
  label: string;
}

/**
 * The draggable divider between two panels.
 *
 * It reports a ratio rather than a pixel delta, because the layout is stored in ratios so that a window
 * resize does not change the arrangement. Pointer capture is what makes the drag survive the pointer
 * leaving the handle, which it does immediately, since the handle is a few pixels wide and people move
 * faster than that.
 */
export const ResizeHandle = ({
  orientation,
  onResize,
  containerRef,
  fromEnd = false,
  label,
}: ResizeHandleProps) => {
  const dragging = useRef(false);

  const report = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (container === null) return;
      const box = container.getBoundingClientRect();
      const ratio =
        orientation === "vertical"
          ? (clientX - box.left) / box.width
          : (clientY - box.top) / box.height;
      onResize(fromEnd ? 1 - ratio : ratio);
    },
    [containerRef, fromEnd, onResize, orientation],
  );

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragging.current) return;
      report(event.clientX, event.clientY);
    };
    const up = () => {
      dragging.current = false;
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      up();
    };
  }, [report]);

  return (
    <button
      type="button"
      aria-label={label}
      className={
        orientation === "vertical" ? styles.vertical : styles.horizontal
      }
      onPointerDown={(event) => {
        dragging.current = true;
        // While dragging, the cursor and the no-select apply to the whole window: without them the
        // pointer flickers between shapes and the drag selects text in whatever it passes over.
        document.body.style.cursor =
          orientation === "vertical" ? "col-resize" : "row-resize";
        document.body.style.userSelect = "none";
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      // Keyboard resizing, because a divider that only responds to a pointer is a divider some people
      // cannot move at all.
      onKeyDown={(event) => {
        const container = containerRef.current;
        if (container === null) return;
        const box = container.getBoundingClientRect();
        const step = 16 / (orientation === "vertical" ? box.width : box.height);
        const back = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
        const forward = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
        if (event.key !== back && event.key !== forward) return;
        event.preventDefault();
        const delta = event.key === forward ? step : -step;
        onResize(
          readCurrentRatio(
            event.currentTarget,
            container,
            orientation,
            fromEnd,
          ) + delta,
        );
      }}
    />
  );
};

/** Where the handle sits now, as a ratio, so a keyboard nudge is relative to what is on screen. */
function readCurrentRatio(
  handle: HTMLElement,
  container: HTMLElement,
  orientation: "vertical" | "horizontal",
  fromEnd: boolean,
): number {
  const handleBox = handle.getBoundingClientRect();
  const box = container.getBoundingClientRect();
  const ratio =
    orientation === "vertical"
      ? (handleBox.left + handleBox.width / 2 - box.left) / box.width
      : (handleBox.top + handleBox.height / 2 - box.top) / box.height;
  return fromEnd ? 1 - ratio : ratio;
}
