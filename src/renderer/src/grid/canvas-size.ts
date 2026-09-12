/**
 * When a canvas is told how big it now is.
 *
 * A canvas has one size, and everything that draws on it or reasons about it has to agree on that
 * number. What arrives from the browser does not: a divider drag fires the observer several times
 * in a single frame, a collapsed slot reports zero, and a layout pass can report the size it
 * already had. Applying each of those verbatim means, respectively, several surface reallocations
 * per frame, a WebGL context resized to nothing, and pointless redraws.
 *
 * So the rule lives here, on its own and pure enough to test: one apply per frame, for the latest
 * usable size. The element and the observer stay in the component — this decides *whether* and
 * *when*, not how to measure.
 */

export interface Size {
  width: number;
  height: number;
}

export interface SizeSync {
  /** The box's size as the browser last reported it. Applied on the next frame, or dropped. */
  request(size: Size): void;
  dispose(): void;
}

function same(a: Size | null, b: Size): boolean {
  return a !== null && a.width === b.width && a.height === b.height;
}

export function createSizeSync(
  apply: (size: Size) => void,
  schedule: (run: () => void) => number = requestAnimationFrame,
  cancel: (handle: number) => void = cancelAnimationFrame,
): SizeSync {
  let pending: Size | null = null;
  let handle: number | null = null;
  let applied: Size | null = null;

  // The comparison happens here rather than in `request`, so the last report of a frame is the one
  // that counts: a drag that passes through a size and comes back to the one already applied ends
  // up applying nothing, instead of leaving the size it passed through queued.
  const flush = () => {
    handle = null;
    const size = pending;
    pending = null;
    if (size === null || same(applied, size)) return;
    applied = size;
    apply(size);
  };

  return {
    request(size) {
      // A zero in either axis is a panel that is closed or has not been laid out yet. Passing it on
      // would resize the drawing surface to nothing, and on WebGL that costs the context.
      if (size.width === 0 || size.height === 0) return;
      if (handle === null && same(applied, size)) return;
      pending = size;
      if (handle === null) handle = schedule(flush);
    },
    dispose() {
      pending = null;
      if (handle === null) return;
      cancel(handle);
      handle = null;
    },
  };
}
