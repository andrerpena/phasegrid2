import { hexToNumber } from "@renderer/lib/color";
import type { GridColors } from "@renderer/theming/theme";
import { Container } from "pixi.js";
import type { ControlLayout, DisplayLayout } from "../layout";
import type { KnobStyle } from "./Knob";
import { KnobRow } from "./KnobRow";
import { SimpleWave, type SimpleWaveStyle } from "./SimpleWave";

/**
 * The face an oscillator wears: its wave on the left, its knobs on the right.
 *
 * One component for the sine, the sawtooth, the pulse, the LFO and whatever plays a wave next. What
 * differs between them is data: which wave the engine drew, and how many knobs the layout placed. It
 * takes both as plain values and draws, with no store and no engine, which is what lets a story show
 * the same face with one knob or three.
 */

export interface FaceStyle {
  knob: KnobStyle;
  wave: SimpleWaveStyle;
}

/** The face's colours from the theme and the module's accent, the one way every caller builds them. */
export function faceStyle(colors: GridColors, accent: number): FaceStyle {
  return {
    knob: {
      arc: accent,
      track: hexToNumber(colors.gridLine),
      body: hexToNumber(colors.knobBody),
      pointer: hexToNumber(colors.knobPointer),
      label: hexToNumber(colors.knobLabel),
    },
    wave: {
      curve: accent,
      grid: hexToNumber(colors.gridLine),
      background: hexToNumber(colors.background),
      border: hexToNumber(colors.nodeStroke),
    },
  };
}

export class OscillatorFace {
  readonly view = new Container();
  private readonly wave: SimpleWave;
  private readonly knobs: KnobRow;

  constructor(
    display: DisplayLayout,
    controls: readonly ControlLayout[],
    style: FaceStyle,
  ) {
    this.wave = new SimpleWave(display.width, display.height, style.wave);
    this.wave.view.position.set(display.x, display.y);
    this.knobs = new KnobRow(controls, style.knob);
    this.view.addChild(this.wave.view, this.knobs.view);
  }

  /** One cycle, -1..1, as the engine drew it. The face never works a wave out for itself. */
  setWave(samples: ArrayLike<number>): void {
    this.wave.setSamples(samples);
  }

  setValue(paramId: string, fraction: number): void {
    this.knobs.setValue(paramId, fraction);
  }

  setLive(paramId: string, fraction: number | null): void {
    this.knobs.setLive(paramId, fraction);
  }

  setStyle(style: FaceStyle): void {
    this.wave.setStyle(style.wave);
    this.knobs.setStyle(style.knob);
  }

  destroy(): void {
    this.wave.destroy();
    this.knobs.destroy();
    this.view.destroy({ children: true });
  }
}
