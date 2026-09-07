import { hexToNumber } from "@renderer/lib/color";
import { useThemeStore } from "@renderer/theming/theme-store";
import { Application, type Container } from "pixi.js";
import "pixi.js/unsafe-eval";
import { useEffect, useRef } from "react";

export interface PixiStageProps {
  /**
   * Builds what to show. Called once, with the application, and returns the thing to display plus an
   * optional teardown. Everything a component needs must arrive through here as plain data.
   */
  build: (app: Application) => { view: Container; destroy?: () => void };
  width?: number;
  height?: number;
  /** Draws on the grid's ground rather than the panel's, for anything that will live on the canvas. */
  gridBackground?: boolean;
}

/**
 * Hosts one Pixi component so it can be looked at on its own.
 *
 * This is the whole apparatus a story needs. If a component cannot be shown through this, it is reading
 * something it should have been given: a store, the engine, a socket. Keeping that boundary visible is
 * more of the point than the pictures are.
 */
export const PixiStage = ({
  build,
  width = 320,
  height = 220,
  gridBackground = true,
}: PixiStageProps) => {
  const host = useRef<HTMLDivElement>(null);
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    let cancelled = false;
    let app: Application | null = null;
    let teardown: (() => void) | undefined;

    const setup = async () => {
      const element = host.current;
      if (element === null) return;
      const created = new Application();
      await created.init({
        width,
        height,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio,
        background: hexToNumber(
          gridBackground ? theme.grid.background : theme.colors.card,
        ),
      });
      // React can unmount during the await; without this the canvas leaks and never gets destroyed.
      if (cancelled) {
        created.destroy(true, { children: true });
        return;
      }
      app = created;
      element.appendChild(created.canvas);
      const built = build(created);
      teardown = built.destroy;
      created.stage.addChild(built.view);
    };

    void setup();
    return () => {
      cancelled = true;
      teardown?.();
      app?.destroy(true, { children: true });
    };
  }, [build, width, height, gridBackground, theme]);

  return <div ref={host} style={{ width, height }} />;
};
