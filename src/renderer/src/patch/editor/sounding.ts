import { gridRegistry } from "@renderer/grid/grid-registry";
import { useEffect, useState } from "react";

/**
 * The character ranges of a module's text property that are sounding right now.
 *
 * Read off the canvas rather than from a store of its own, because the canvas is where the engine's
 * telemetry already lands: the piano roll on the face and the highlight in the editor are two views
 * of one reading, and a second subscription to the same shared memory would be a second thing to
 * keep in step.
 *
 * Polled on the frame rather than pushed, for the same reason the canvas is: this changes sixty
 * times a second, and a subscription per change would be sixty React renders whether anything
 * moved or not. The comparison below means a render happens only when the set actually changes,
 * which for a pattern is a handful of times a bar.
 */
export function useSoundingRanges(
  moduleId: string,
  textId: string,
): { from: number; to: number }[] {
  const [ranges, setRanges] = useState<{ from: number; to: number }[]>([]);

  useEffect(() => {
    let frame = 0;
    let shown = "";
    const tick = (): void => {
      const node = gridRegistry.get()?.renderer.allNodes().get(moduleId);
      const next = node?.soundingOf(textId) ?? [];
      const key = next.map((r) => `${r.from}:${r.to}`).join(",");
      if (key !== shown) {
        shown = key;
        setRanges(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [moduleId, textId]);

  return ranges;
}
