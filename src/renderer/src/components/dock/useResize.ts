import { useCallback, useState } from "react";

type GetConstraints = () => { min: number; max: number };

/**
 * A drag on a divider, in pixels.
 *
 * Pixels rather than ratios because that is what a pointer reports, and because the arithmetic for
 * "where did the pointer start and where is it now" is the part that has to be exactly right. What
 * the caller stores is its own business — the dock converts to a fraction of the container before
 * saving, so a layout still makes sense on a different display.
 *
 * Listeners go on the document, not the handle: a fast drag leaves the handle behind, and a handler
 * bound to the handle stops receiving moves exactly when the drag gets interesting.
 */
export function useResize(
  onResize: (size: number) => void,
  getStartSize: () => number,
  getConstraints: GetConstraints,
  /** The panel grows as the pointer moves *towards* the origin — a right-hand or bottom edge. */
  isReverse = false,
  /** Vertical drag rather than horizontal. */
  isHorizontal = false,
): { onResizeStart: (e: React.MouseEvent) => void; isDragging: boolean } {
  const [isDragging, setIsDragging] = useState(false);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const startCoordinate = isHorizontal ? e.clientY : e.clientX;
      const startSize = getStartSize();

      const handleMove = (moveEvent: MouseEvent) => {
        const current = isHorizontal ? moveEvent.clientY : moveEvent.clientX;
        const delta = current - startCoordinate;
        const next = startSize + (isReverse ? -delta : delta);
        const { min, max } = getConstraints();
        onResize(Math.max(min, Math.min(next, max)));
      };

      const handleEnd = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleEnd);
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleEnd);
    },
    [onResize, getStartSize, getConstraints, isReverse, isHorizontal],
  );

  return { onResizeStart, isDragging };
}
