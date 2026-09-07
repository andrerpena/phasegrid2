import { hexToNumber } from "@renderer/lib/color";
import { useThemeStore } from "@renderer/theming/theme-store";
import type { SignalRole } from "@shared/protocol/catalog";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Container, Text } from "pixi.js";
import { useCallback } from "react";
import { PixiStage } from "../stories/PixiStage";
import { Port } from "./Port";

/**
 * A port takes its colour from the signal role in the engine's descriptor, so this story is also the
 * legend: every role the engine can declare, in the colour the grid will draw it.
 */
const meta: Meta = { title: "Grid/Port", parameters: { layout: "centered" } };
export default meta;

const ROLES: SignalRole[] = [
  "any",
  "audio",
  "cv",
  "gate",
  "pitch",
  "phase",
  "note",
];

const AllRoles = ({ connected }: { connected: boolean }) => {
  const theme = useThemeStore((s) => s.theme);
  const build = useCallback(() => {
    const view = new Container();
    const ports: Port[] = [];
    for (const [i, role] of ROLES.entries()) {
      const port = new Port(5, hexToNumber(theme.grid.signal[role]));
      port.update({ connected });
      port.view.position.set(30, 24 + i * 26);
      ports.push(port);
      const label = new Text({
        text: role,
        style: {
          fontSize: 11,
          fill: 0x8a8f98,
          fontFamily: "system-ui, sans-serif",
        },
      });
      label.position.set(48, 16 + i * 26);
      view.addChild(port.view, label);
    }
    return {
      view,
      destroy: () => {
        for (const p of ports) p.destroy();
      },
    };
  }, [theme, connected]);
  return <PixiStage build={build} width={180} height={210} />;
};

/** Hollow: nothing is plugged in. This is how you read which inputs of a patch are actually driven. */
export const Unconnected: StoryObj = {
  render: () => <AllRoles connected={false} />,
};

/** Filled: something is. */
export const Connected: StoryObj = {
  render: () => <AllRoles connected={true} />,
};
