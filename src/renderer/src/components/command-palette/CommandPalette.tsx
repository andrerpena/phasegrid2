import { commandRegistry } from "@renderer/commands/registry";
import { formatKey } from "@renderer/keybindings/display";
import { keybindingRegistry } from "@renderer/keybindings/keybindings";
import type { MenuItem } from "@renderer/menu/types";
import { Modal, ModalFrame } from "../floating/modal";
import { SearchableTreeNavigator } from "./SearchableTreeNavigator";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Type to find a command, enter to run it.
 *
 * The list, the search and the keyboard all come from `SearchableTreeNavigator`, which is the same
 * component the module catalogue uses. That is deliberate: these are one interaction, and two
 * implementations of it would behave almost identically, which is worse than behaving differently
 * on purpose.
 */
export const CommandPalette = ({ open, onClose }: CommandPaletteProps) => {
  if (!open) return null;

  // Read on every render of an open palette rather than memoised.
  //
  // Commands are registered after the first render and more can be registered at any point, so a list
  // computed once and cached is empty forever and every command silently unreachable — which is
  // exactly what happened. The registry is a map lookup over a few dozen entries; caching it saved
  // nothing and cost the feature.
  const items: MenuItem[] = commandRegistry.runnable().map((command) => {
    const key = keybindingRegistry.keyFor(command.id);
    return {
      id: command.id,
      label: command.name,
      subtitle: command.id,
      keywords: command.description,
      ...(key === undefined ? {} : { trailing: formatKey(key) }),
      onExecute: () => {
        onClose();
        void commandRegistry.dispatch(command.id);
      },
    };
  });

  return (
    <Modal open={open} onClose={onClose} size="lg" alignment="top">
      <ModalFrame data-testid="command-palette">
        <SearchableTreeNavigator
          items={items}
          placeHolder="Type a command"
          autoFocusInput
          data-testid="command-palette-navigator"
        />
      </ModalFrame>
    </Modal>
  );
};
