import type { ParamCurve } from "./catalog";

/**
 * The taper between a knob's turn and the number it stands for.
 *
 * A param crosses the protocol in DISPLAY units -- seconds, hertz, percent -- and the engine
 * normalizes it with the param's own curve before anything else happens to it
 * (`engine/src/core/Param.cpp`). Modulation is summed in that normalized space, so the same curve
 * decides both how far a drag moves a value and where a modulated knob is drawn. Two implementations
 * of that would be two answers to "where is this knob", so this file is the port of `Param.cpp` and
 * the only place the renderer does the arithmetic.
 *
 * `fraction` is always 0..1 and `value` is always in the param's own range; both clamp, because a
 * drag runs off the end of a knob and a modulation signal runs off the end of a range.
 */

export interface Tapered {
  min: number;
  max: number;
  curve?: ParamCurve;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Where a value sits on its knob, 0 to 1. The inverse of `paramValueAt`. */
export function paramFractionOf(param: Tapered, value: number): number {
  const span = param.max - param.min;
  if (span <= 0) return 0;
  const v = Math.min(param.max, Math.max(param.min, value));
  switch (param.curve) {
    // A log param cannot reach zero, and the engine refuses one whose min is not above it.
    case "log":
      return param.min > 0
        ? clamp01(Math.log(v / param.min) / Math.log(param.max / param.min))
        : clamp01((v - param.min) / span);
    case "exp":
      return clamp01(Math.sqrt((v - param.min) / span));
    case "quartic":
      return clamp01(Math.sqrt(Math.sqrt((v - param.min) / span)));
    default:
      return clamp01((v - param.min) / span);
  }
}

/** The value a fraction of a knob's turn stands for. The inverse of `paramFractionOf`. */
export function paramValueAt(param: Tapered, fraction: number): number {
  const n = clamp01(fraction);
  const span = param.max - param.min;
  switch (param.curve) {
    case "log":
      return param.min > 0
        ? param.min * (param.max / param.min) ** n
        : param.min + span * n;
    case "exp":
      return param.min + span * n * n;
    case "quartic":
      return param.min + span * n * n * n * n;
    default:
      return param.min + span * n;
  }
}
