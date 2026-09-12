import { Maximize2 } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { TextInput } from "../../form-controls";
import type {
  EditFieldLifecycle,
  EditFieldRendererProps,
  EditFieldRendererResult,
} from "./types";

/**
 * A string a module owns: a note pattern, an expression, a path.
 *
 * One line, because that is what fits in a form and what most values are, plus a button that opens
 * the same value in a proper editor. The button is not a shortcut to somewhere else -- it is the
 * same field, larger: a pattern of any length is unreadable in a 200-pixel input, and a form that
 * only offered the input would make the inspector the wrong place to keep it.
 *
 * What "a proper editor" means is not this component's business. It calls `metadata.onExpand`,
 * which the inspector supplies, so the form stays free of Monaco and of what a module's language is.
 *
 * Committed on blur and on Enter, never per keystroke. A module's text is structural -- the engine
 * rebuilds the node to apply it -- so a field that reported every character would recompile the
 * patch a dozen times to type a pattern, and leave a dozen entries in the undo history to step back
 * through. Escape puts the field back to what the document holds.
 */
export const CodeFieldRenderer = ({
  fieldState,
  hasError,
  metadata,
  autoFocus,
}: EditFieldRendererProps): EditFieldRendererResult => {
  const inputRef = useRef<HTMLInputElement>(null);
  const expand = metadata.onExpand;
  const committed = (fieldState.state.value ?? "") as string;
  const [draft, setDraft] = useState(committed);

  // Follows the document when the change came from somewhere else: the editor modal, an undo, or
  // another field. Typing is not affected, because typing is what put `draft` ahead of it.
  useEffect(() => setDraft(committed), [committed]);

  const commit = (): void => {
    if (draft !== committed) fieldState.handleChange(draft);
  };

  const lifecycle: EditFieldLifecycle = {
    onEnterEdit: () => {
      setTimeout(() => inputRef.current?.focus(), 0);
    },
  };

  const element = (
    <div className="flex w-full items-center gap-1">
      <TextInput
        ref={inputRef}
        id={fieldState.name}
        name={fieldState.name}
        onBlur={() => {
          commit();
          fieldState.handleBlur();
        }}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(committed);
          }
        }}
        type="text"
        spellCheck={false}
        value={draft}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          setDraft(e.target.value)
        }
        placeholder={metadata.placeholder ?? metadata.description}
        hasError={hasError}
        autoFocus={autoFocus}
        className="font-mono text-xs"
      />
      {expand !== undefined && (
        <button
          type="button"
          onClick={() => expand()}
          title="Open the editor"
          aria-label="Open the editor"
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-input opacity-70 hover:bg-accent hover:opacity-100"
        >
          <Maximize2 aria-hidden className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  return { element, lifecycle };
};
