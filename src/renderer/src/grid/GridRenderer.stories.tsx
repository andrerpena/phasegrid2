import { useThemeStore } from "@renderer/theming/theme-store";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Container } from "pixi.js";
import { useCallback } from "react";
import { GridRenderer } from "./GridRenderer";
import { DEMO_PATCH, DESCRIPTORS } from "./stories/fixtures";
import { PixiStage } from "./stories/PixiStage";

/**
 * A whole patch, drawn from a document and a catalogue and nothing else.
 *
 * No engine, no socket, no stores. That is the property worth protecting: the renderer takes data and
 * draws, so it can be looked at here exactly as it will appear in the application, and anything it
 * cannot draw from a fixture is a dependency it should not have.
 */
const meta: Meta = { title: "Grid/Patch", parameters: { layout: "centered" } };
export default meta;

const PatchStage = ({ zoom }: { zoom: number }) => {
  const theme = useThemeStore((s) => s.theme);
  const build = useCallback(
    (app: Parameters<Parameters<typeof PixiStage>[0]["build"]>[0]) => {
      const renderer = new GridRenderer(app, theme, DESCRIPTORS);
      renderer.viewport.zoom = zoom;
      renderer.viewport.x = 10;
      renderer.viewport.y = 10;
      renderer.drawBackground();
      renderer.sync(DEMO_PATCH);
      // The renderer puts its own layers on the stage, so the stage has nothing further to add.
      return { view: new Container(), destroy: () => renderer.destroy() };
    },
    [theme, zoom],
  );
  return <PixiStage build={build} width={1000} height={480} />;
};

export const SynthVoice: StoryObj = {
  args: { zoom: 0.85 },
  argTypes: {
    zoom: { control: { type: "range", min: 0.2, max: 2, step: 0.05 } },
  },
  render: (args) => <PatchStage zoom={(args as { zoom: number }).zoom} />,
};

/** Zoomed out far enough that the grid rules stop being drawn, which is deliberate below a threshold. */
export const ZoomedOut: StoryObj = { render: () => <PatchStage zoom={0.3} /> };

/** Close in, where the knob arcs and port rings are meant to hold up. */
export const ZoomedIn: StoryObj = { render: () => <PatchStage zoom={1.6} /> };
