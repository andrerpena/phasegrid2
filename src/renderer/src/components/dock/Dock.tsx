import { useLayoutStore } from "@renderer/layout/layout-store";
import { cn } from "@renderer/utils/cn";
import { type ReactNode, useCallback, useRef } from "react";
import { HorizontalResizeHandle } from "../resize-handle/HorizontalResizeHandle";
import { VerticalResizeHandle } from "../resize-handle/VerticalResizeHandle";
import { useResize } from "./useResize";

export interface DockProps {
  /** A full-width strip above everything, for the transport. */
  top?: ReactNode;
  leftTop?: ReactNode;
  leftBottom?: ReactNode;
  /** The main surface. The grid lives here, and it is the one slot that never scrolls. */
  center: ReactNode;
  centerBottom?: ReactNode;
  rightTop?: ReactNode;
  rightBottom?: ReactNode;
  /** A full-width strip below everything, for the status bar. */
  bottom?: ReactNode;
}

/**
 * The window layout: a centre surface with columns beside it and strips above and below.
 *
 * A slot with nothing in it takes no space at all, and a column with only one of its two panels gives
 * that panel the whole column. That is the difference between a dock and a picture of one: emptying a
 * slot has to actually give the room back, or closing a panel leaves a hole where it was.
 *
 * Sizes are stored as fractions rather than pixels, so a layout saved on a large display still makes
 * sense on a small one. Dragging works in pixels, because that is what a pointer reports; the
 * conversion happens here, once, at the point where a drag becomes a stored size.
 */
export const Dock = ({
  top,
  leftTop,
  leftBottom,
  center,
  centerBottom,
  rightTop,
  rightBottom,
  bottom,
}: DockProps) => {
  const layout = useLayoutStore();
  const bodyRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);

  const hasLeftTop = leftTop !== undefined && leftTop !== null;
  const hasLeftBottom = leftBottom !== undefined && leftBottom !== null;
  const hasRightTop = rightTop !== undefined && rightTop !== null;
  const hasRightBottom = rightBottom !== undefined && rightBottom !== null;
  const hasCenterBottom = centerBottom !== undefined && centerBottom !== null;

  const showLeft = layout.leftVisible && (hasLeftTop || hasLeftBottom);
  const showRight = layout.rightVisible && (hasRightTop || hasRightBottom);
  const showCenterBottom = layout.centerBottomVisible && hasCenterBottom;
  // Only when both panels are there is there a divider between them; otherwise the one that is
  // present owns the column.
  const splitLeft = hasLeftTop && hasLeftBottom;
  const splitRight = hasRightTop && hasRightBottom;

  const bodyWidth = useCallback(() => bodyRef.current?.offsetWidth ?? 1, []);
  const columnHeight = useCallback(
    (ref: typeof leftRef) => ref.current?.offsetHeight ?? 1,
    [],
  );

  // A column's width: pixels in from the pointer, a fraction of the window out to the store.
  const widthLimits = useCallback(
    () => ({ min: 0.1 * bodyWidth(), max: 0.9 * bodyWidth() }),
    [bodyWidth],
  );

  const leftResize = useResize(
    (px) => layout.setSize("leftWidth", px / bodyWidth()),
    () => layout.leftWidth * bodyWidth(),
    widthLimits,
  );

  const rightResize = useResize(
    (px) => layout.setSize("rightWidth", px / bodyWidth()),
    () => layout.rightWidth * bodyWidth(),
    widthLimits,
    true,
  );

  const leftSplitResize = useResize(
    (px) => layout.setSize("leftSplit", px / columnHeight(leftRef)),
    () => layout.leftSplit * columnHeight(leftRef),
    () => ({
      min: 0.1 * columnHeight(leftRef),
      max: 0.9 * columnHeight(leftRef),
    }),
    false,
    true,
  );

  const rightSplitResize = useResize(
    (px) => layout.setSize("rightSplit", px / columnHeight(rightRef)),
    () => layout.rightSplit * columnHeight(rightRef),
    () => ({
      min: 0.1 * columnHeight(rightRef),
      max: 0.9 * columnHeight(rightRef),
    }),
    false,
    true,
  );

  const centerBottomResize = useResize(
    (px) => layout.setSize("centerBottomHeight", px / columnHeight(centerRef)),
    () => layout.centerBottomHeight * columnHeight(centerRef),
    () => ({
      min: 0.1 * columnHeight(centerRef),
      max: 0.9 * columnHeight(centerRef),
    }),
    true,
    true,
  );

  const column = "relative grid min-h-0 bg-background";

  return (
    <div className="flex h-screen w-screen min-h-0 min-w-0 flex-col">
      {top !== undefined && (
        <div className="w-full flex-none border-b border-border bg-background">
          {top}
        </div>
      )}

      <div className="flex min-h-0 flex-1" ref={bodyRef}>
        {showLeft && (
          <div
            className={cn(column, "border-r border-border")}
            ref={leftRef}
            style={{
              width: `${layout.leftWidth * 100}%`,
              gridTemplateRows: splitLeft
                ? `${layout.leftSplit}fr ${1 - layout.leftSplit}fr`
                : "1fr",
            }}
          >
            {hasLeftTop && (
              <div className="relative min-h-0 overflow-hidden">{leftTop}</div>
            )}
            {hasLeftBottom && (
              <div className="relative min-h-0 overflow-hidden">
                {splitLeft && (
                  <VerticalResizeHandle
                    onResizeStart={leftSplitResize.onResizeStart}
                    isDragging={leftSplitResize.isDragging}
                    align="top"
                  />
                )}
                {leftBottom}
              </div>
            )}
            <HorizontalResizeHandle
              onResizeStart={leftResize.onResizeStart}
              isDragging={leftResize.isDragging}
              align="right"
            />
          </div>
        )}

        <div
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
          ref={centerRef}
        >
          <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
            {center}
          </div>
          {showCenterBottom && (
            <div
              className="relative overflow-hidden border-t border-border"
              style={{ height: `${layout.centerBottomHeight * 100}%` }}
            >
              <VerticalResizeHandle
                onResizeStart={centerBottomResize.onResizeStart}
                isDragging={centerBottomResize.isDragging}
                align="top"
              />
              <div className="h-full min-h-0 overflow-hidden">
                {centerBottom}
              </div>
            </div>
          )}
        </div>

        {showRight && (
          <div
            className={cn(column, "border-l border-border")}
            ref={rightRef}
            style={{
              width: `${layout.rightWidth * 100}%`,
              gridTemplateRows: splitRight
                ? `${layout.rightSplit}fr ${1 - layout.rightSplit}fr`
                : "1fr",
            }}
          >
            <HorizontalResizeHandle
              onResizeStart={rightResize.onResizeStart}
              isDragging={rightResize.isDragging}
              align="left"
            />
            {hasRightTop && (
              <div className="relative min-h-0 overflow-hidden">{rightTop}</div>
            )}
            {hasRightBottom && (
              <div className="relative min-h-0 overflow-hidden">
                {splitRight && (
                  <VerticalResizeHandle
                    onResizeStart={rightSplitResize.onResizeStart}
                    isDragging={rightSplitResize.isDragging}
                    align="top"
                  />
                )}
                {rightBottom}
              </div>
            )}
          </div>
        )}
      </div>

      {bottom !== undefined && (
        <div className="w-full flex-none border-t border-border bg-background">
          {bottom}
        </div>
      )}
    </div>
  );
};
