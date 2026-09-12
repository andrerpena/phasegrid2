import type React from "react";
import { forwardRef } from "react";
import { type NumericRange, useNumericDraft } from "./numeric-draft";
import { TextInput, type TextInputProps } from "./TextInput";

export interface NumberInputProps
  extends Omit<TextInputProps, "value" | "onChange" | "type" | "min" | "max">,
    NumericRange {
  value: number;
  onChange: (value: number) => void;
}

/**
 * A `TextInput` for a number, following the rule in `numeric-draft.ts`: what is shown is what is
 * being typed, and what is handed on is only ever a value.
 *
 * `type="number"` stays, for the arrow keys and `step`. React leaves a number input's DOM value
 * alone while the browser reports it as `""` -- a lone `-` -- so the draft survives a controlled
 * render, which is what makes this work.
 */
const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  (
    { value, onChange, min, max, integer, onBlur, onKeyDown, ...props },
    ref,
  ) => {
    const draft = useNumericDraft({ value, onChange, min, max, integer });
    return (
      <TextInput
        ref={ref}
        type="number"
        min={min}
        max={max}
        {...props}
        value={draft.value}
        onChange={draft.onChange}
        // The draft settles first, so a form's own blur handling sees the committed value.
        onBlur={(event: React.FocusEvent<HTMLInputElement>) => {
          draft.onBlur();
          onBlur?.(event);
        }}
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
          draft.onKeyDown(event);
          onKeyDown?.(event);
        }}
      />
    );
  },
);

NumberInput.displayName = "NumberInput";

export { NumberInput };
