import type React from "react";
import { useState } from "react";

/**
 * The rule for typing a number into a field.
 *
 * A controlled number input that parses every keystroke and writes the parse straight back cannot
 * be emptied: backspacing the last digit gives `""`, which `Number` reads as `0`, and the `0` is
 * back before the next key. The tempo field had the same bug in a different coat -- `parseFloat("")`
 * is `NaN`, the store clamped the next digit to the minimum, and `137` came out as `20`.
 *
 * So the field keeps a DRAFT, the text as typed, and shows that for as long as it is being typed in.
 * The number is only handed on when the text is one worth taking -- a finite number, inside the
 * range when there is one -- and what is handed on when the field is left is settled from the draft:
 * an emptied field goes back to what it had, an out-of-range one is clamped. Between those two
 * moments nothing downstream sees an intermediate that is not a value.
 *
 * Pure functions first, so the rule is tested without a DOM, and a hook that applies them to an
 * `<input>` after.
 */

export interface NumericRange {
  min?: number;
  max?: number;
  /** Only whole numbers are values; anything else is held until the field is left, then rounded. */
  integer?: boolean;
}

/** The number a field's text is, or null for text that is not one yet: `""`, `"-"`, `"1e"`. */
export function parseNumeric(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Is this a number to hand on while it is still being typed? */
export function acceptable(n: number, range: NumericRange): boolean {
  if (!Number.isFinite(n)) return false;
  if (range.integer === true && !Number.isInteger(n)) return false;
  if (range.min !== undefined && n < range.min) return false;
  if (range.max !== undefined && n > range.max) return false;
  return true;
}

/** What the field commits when it is left: the value it had for text that is not a number, else the text clamped into range. */
export function settle(
  text: string,
  value: number,
  range: NumericRange,
): number {
  const parsed = parseNumeric(text);
  if (parsed === null) return value;
  let n = parsed;
  if (range.min !== undefined) n = Math.max(range.min, n);
  if (range.max !== undefined) n = Math.min(range.max, n);
  return range.integer === true ? Math.round(n) : n;
}

export interface NumericDraftOptions extends NumericRange {
  value: number;
  onChange: (value: number) => void;
}

/** The props that make an `<input>` follow the rule above. Spread them onto one. */
export interface NumericDraftProps {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function useNumericDraft({
  value,
  onChange,
  ...range
}: NumericDraftOptions): NumericDraftProps {
  // Null is "show the value": a knob drag or an undo shows through the moment nobody is typing.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (): void => {
    if (draft === null) return;
    const settled = settle(draft, value, range);
    if (settled !== value) onChange(settled);
    setDraft(null);
  };

  return {
    value: draft ?? String(value),
    onChange: (event) => {
      const text = event.target.value;
      setDraft(text);
      const parsed = parseNumeric(text);
      if (parsed !== null && acceptable(parsed, range) && parsed !== value)
        onChange(parsed);
    },
    onBlur: commit,
    onKeyDown: (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        setDraft(null);
      }
    },
  };
}
