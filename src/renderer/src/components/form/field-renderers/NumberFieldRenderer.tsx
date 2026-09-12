import { useRef } from "react";
import { NumberInput } from "../../form-controls";
import type {
  EditFieldLifecycle,
  EditFieldRendererProps,
  EditFieldRendererResult,
} from "./types";

export const NumberFieldRenderer = ({
  fieldState,
  hasError,
  metadata,
  autoFocus,
}: EditFieldRendererProps): EditFieldRendererResult => {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasSelectedRef = useRef(false);

  const lifecycle: EditFieldLifecycle = {
    onEnterEdit: () => {
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          if (!hasSelectedRef.current) {
            inputRef.current.select();
            hasSelectedRef.current = true;
          }
        }
      }, 0);
    },
    onExitEdit: () => {
      hasSelectedRef.current = false;
    },
  };

  const value = fieldState.state.value;
  const element = (
    // What is typed is shown as typed, and only a value is handed to the form: see `NumberInput`.
    // Before this, backspacing a `0` gave `Number("")`, which is `0`, and the `0` was back before
    // the next key.
    <NumberInput
      ref={inputRef}
      id={fieldState.name}
      name={fieldState.name}
      onBlur={fieldState.handleBlur}
      value={typeof value === "number" ? value : 0}
      onChange={(next) => fieldState.handleChange(next)}
      min={metadata.min}
      max={metadata.max}
      integer={metadata.integer}
      placeholder={metadata.description}
      hasError={hasError}
      autoFocus={autoFocus}
    />
  );

  return { element, lifecycle };
};
