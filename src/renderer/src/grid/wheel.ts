/**
 * What a `wheel` event actually is.
 *
 * On modern hardware one event type carries four different gestures, and telling them apart is the
 * whole of making a canvas feel right. The platform does not say which device sent the event, so
 * this is a heuristic — but the devices produce clearly different deltas, and being wrong either way
 * is recoverable by the other gesture.
 *
 * Pure, and separate from the interaction class, because it is the part with the judgement in it and
 * the part worth testing. Everything else about the wheel is one call to the viewport.
 */

/** Above this, a pixel delta came from a mouse wheel rather than a trackpad. */
const TRACKPAD_DELTA_LIMIT = 50;
/** How hard a trackpad pinch zooms. Exponential, so pinching in and back out is a round trip. */
const PINCH_SENSITIVITY = 0.01;
/** One wheel click. */
const WHEEL_STEP = 1.1;

export type WheelGesture =
  | { kind: "none" }
  /** Screen pixels to move the view by. */
  | { kind: "pan"; dx: number; dy: number }
  /** Multiplied into the current zoom, about the pointer. */
  | { kind: "zoom"; factor: number };

export function classifyWheel(event: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
}): WheelGesture {
  // A trackpad pinch arrives as a wheel event with `ctrlKey` set and no key actually held. A real
  // control- or command-scroll is a deliberate ask to zoom, and is told apart by the other modifier.
  const pinch = event.ctrlKey && !event.metaKey;
  const modifierZoom = event.metaKey;

  if (pinch) {
    if (event.deltaY === 0) return { kind: "none" };
    return {
      kind: "zoom",
      factor: Math.exp(-event.deltaY * PINCH_SENSITIVITY),
    };
  }

  // Pixel deltas, small, and usually on both axes: a two-finger scroll. This pans. It is the most
  // common way anyone moves around a canvas on a laptop, and binding it to zoom is what made
  // scrolling lurch the patch towards and away from you instead of moving it.
  const trackpadScroll =
    !modifierZoom &&
    event.deltaMode === 0 &&
    Math.abs(event.deltaY) < TRACKPAD_DELTA_LIMIT &&
    Math.abs(event.deltaX) < TRACKPAD_DELTA_LIMIT;

  if (trackpadScroll) {
    if (event.deltaX === 0 && event.deltaY === 0) return { kind: "none" };
    return { kind: "pan", dx: -event.deltaX, dy: -event.deltaY };
  }

  if (event.deltaY === 0) return { kind: "none" };
  // A wheel, or a held modifier. Stepped, so one click is one recognisable amount.
  return {
    kind: "zoom",
    factor: event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP,
  };
}
