import type React from "react";
import { TextInput } from "../../form-controls";
import type {
  EditFieldLifecycle,
  EditFieldRendererProps,
  EditFieldRendererResult,
} from "./types";

/** Full `#RRGGBB` hex, the only form the native color input accepts. */
const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * Color field: a native `<input type="color">` swatch paired with a hex
 * `TextInput`, both bound to the same field value. Selected when a
 * field's metadata declares `renderer: "color"`.
 *
 * Auto-commits on change (like Toggle/Select) so edits flow straight to
 * the form state — the inspector's debounced push-back does the rest.
 * The swatch always shows a valid hex (falling back to black) while the
 * text input mirrors the raw value so partial edits aren't clobbered.
 */
export const ColorFieldRenderer = ({
  fieldState,
  hasError,
}: EditFieldRendererProps): EditFieldRendererResult => {
  const lifecycle: EditFieldLifecycle = {};
  const raw = (fieldState.state.value ?? "") as string;
  const swatchValue = HEX_RE.test(raw) ? raw : "#000000";

  const commit = (value: string) => {
    fieldState.handleChange(value);
    lifecycle.onValueCommit?.(value);
  };

  const element = (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={`${fieldState.name} color`}
        value={swatchValue}
        onBlur={fieldState.handleBlur}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          commit(e.target.value)
        }
        className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
      />
      <TextInput
        id={fieldState.name}
        name={fieldState.name}
        type="text"
        value={raw}
        onBlur={fieldState.handleBlur}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          commit(e.target.value)
        }
        placeholder="#RRGGBB"
        hasError={hasError}
      />
    </div>
  );

  return { element, lifecycle, autoCommit: true };
};
