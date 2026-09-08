import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delayMs`
 * has elapsed without `value` changing. Ideal for filtering/searching in
 * render, where you want to react to a settled value rather than every
 * keystroke.
 *
 * The timer resets on every change and is cleared on unmount, so the
 * debounced value never updates after the component is gone.
 */
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
