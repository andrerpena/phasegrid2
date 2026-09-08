import { useModalStore } from "@renderer/components/floating/modal/modal-store";
import { useConfigStore } from "@renderer/config/config-store";
import { useEngineStore } from "@renderer/engine/engine-store";
import { useSelectionStore } from "@renderer/selection/selection-store";
import { useEffect } from "react";
import { commandRegistry } from "../commands/registry";
import { bindingsFromConfig } from "./from-config";
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
 *
 * The bindings follow the settings rather than being registered once, so editing them in the settings
 * editor changes the keyboard as you type rather than at the next launch — which is also how you find
 * out you have bound something to a key you use for something else.
 */
export function useKeybindings(): void {
  useEffect(() => {
    const applyBindings = (): void => {
      keybindingRegistry.setBindings(
        bindingsFromConfig(useConfigStore.getState().get("keybindings"))
          .bindings,
      );
    };
    applyBindings();
    const stopFollowingConfig = useConfigStore.subscribe((state, previous) => {
      if (state.computed.keybindings !== previous.computed.keybindings)
        applyBindings();
    });

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
        hasSelection: !useSelectionStore.getState().isEmpty(),
        engineReady: useEngineStore.getState().status === "ready",
      };
      const binding = keybindingRegistry.resolve(eventToKey(event), context);
      if (binding === undefined) return;
      event.preventDefault();
      void commandRegistry.dispatch(binding.command, binding.payload);
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      stopFollowingConfig();
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, []);
}
