import { useLayoutStore } from "@renderer/layout/layout-store";
import { type ReactNode, useRef } from "react";
import { ResizeHandle } from "../resize-handle/ResizeHandle";
import styles from "./Dock.module.css";

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
 * Sizes come from the layout store as ratios, so resizing the window rearranges nothing. Every divider
 * is draggable and every panel can be hidden, because a grid editor is mostly used at whatever size
 * leaves the most room for the grid.
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

  const showLeft =
    layout.leftVisible && (leftTop !== undefined || leftBottom !== undefined);
  const showRight =
    layout.rightVisible &&
    (rightTop !== undefined || rightBottom !== undefined);
  const showCenterBottom =
    layout.centerBottomVisible && centerBottom !== undefined;

  return (
    <div className={styles.root}>
      {top !== undefined && <div className={styles.top}>{top}</div>}

      <div className={styles.body} ref={bodyRef}>
        {showLeft && (
          <div
            className={styles.column}
            ref={leftRef}
            style={{ width: `${layout.leftWidth * 100}%` }}
          >
            <div
              className={styles.panel}
              style={{ height: `${layout.leftSplit * 100}%` }}
            >
              {leftTop}
            </div>
            {leftTop !== undefined && leftBottom !== undefined && (
              <div
                className={styles.splitAnchor}
                style={{ top: `${layout.leftSplit * 100}%` }}
              >
                <ResizeHandle
                  orientation="horizontal"
                  containerRef={leftRef}
                  onResize={(r) => layout.setSize("leftSplit", r)}
                  label="Resize the left column split"
                />
              </div>
            )}
            <div className={styles.panel}>{leftBottom}</div>
            <div className={styles.edgeRight}>
              <ResizeHandle
                orientation="vertical"
                containerRef={bodyRef}
                onResize={(r) => layout.setSize("leftWidth", r)}
                label="Resize the left column"
              />
            </div>
          </div>
        )}

        <div className={styles.center} ref={centerRef}>
          <div className={styles.surface}>{center}</div>
          {showCenterBottom && (
            <>
              <div
                className={styles.splitAnchor}
                style={{ bottom: `${layout.centerBottomHeight * 100}%` }}
              >
                <ResizeHandle
                  orientation="horizontal"
                  containerRef={centerRef}
                  fromEnd
                  onResize={(r) => layout.setSize("centerBottomHeight", r)}
                  label="Resize the panel below the grid"
                />
              </div>
              <div
                className={styles.centerBottom}
                style={{ height: `${layout.centerBottomHeight * 100}%` }}
              >
                {centerBottom}
              </div>
            </>
          )}
        </div>

        {showRight && (
          <div
            className={styles.column}
            ref={rightRef}
            style={{ width: `${layout.rightWidth * 100}%` }}
          >
            <div className={styles.edgeLeft}>
              <ResizeHandle
                orientation="vertical"
                containerRef={bodyRef}
                fromEnd
                onResize={(r) => layout.setSize("rightWidth", r)}
                label="Resize the right column"
              />
            </div>
            <div
              className={styles.panel}
              style={{ height: `${layout.rightSplit * 100}%` }}
            >
              {rightTop}
            </div>
            {rightTop !== undefined && rightBottom !== undefined && (
              <div
                className={styles.splitAnchor}
                style={{ top: `${layout.rightSplit * 100}%` }}
              >
                <ResizeHandle
                  orientation="horizontal"
                  containerRef={rightRef}
                  onResize={(r) => layout.setSize("rightSplit", r)}
                  label="Resize the right column split"
                />
              </div>
            )}
            <div className={styles.panel}>{rightBottom}</div>
          </div>
        )}
      </div>

      {bottom !== undefined && <div className={styles.bottom}>{bottom}</div>}
    </div>
  );
};
