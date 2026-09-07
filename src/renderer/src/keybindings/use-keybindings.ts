import { useModalStore } from "@renderer/components/floating/modal/modal-store";
import { useEngineStore } from "@renderer/engine/engine-store";
import { useEffect } from "react";
import { commandRegistry } from "../commands/registry";
import { DEFAULT_KEYBINDINGS } from "./defaults";
import {
  eventToKey,
  focusScope,
  type KeybindingContext,
  keybindingRegistry,
} from "./keybindings";

/**
 * Listens for keystrokes and dispatches the command they name.
 *
 * On capture, so a binding can take precedence over a component's own handler, and skipped entirely
 * while a text field has focus unless the binding carries a modifier: someone typing a module name
 * should not trigger commands, and that rule is easier to get right here than in every field.
 */
export function useKeybindings(): void {
  useEffect(() => {
    keybindingRegistry.setBindings(DEFAULT_KEYBINDINGS);

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable === true;
      // A bare letter belongs to the field. A chord does not: nobody types command-z into a text box
      // meaning the letter z.
      const chord = event.metaKey || event.ctrlKey || event.altKey;
      if (typing && !chord) return;

      const context: KeybindingContext = {
        focus: focusScope(document.activeElement),
        modalOpen: useModalStore.getState().anyOpen(),
        hasSelection: false,
        engineReady: useEngineStore.getState().status === "ready",
      };
      const binding = keybindingRegistry.resolve(eventToKey(event), context);
      if (binding === undefined) return;
      event.preventDefault();
      void commandRegistry.dispatch(binding.command, binding.payload);
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
}
