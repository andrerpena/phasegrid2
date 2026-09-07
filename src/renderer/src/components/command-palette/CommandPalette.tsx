import { commandRegistry } from "@renderer/commands/registry";
import { Modal } from "../floating/modal/Modal";
import {
  type NavigatorItem,
  SearchableTreeNavigator,
} from "./SearchableTreeNavigator";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Type to find a command, enter to run it.
 *
 * The list, the search and the keyboard all come from `SearchableTreeNavigator`, which is the same
 * component the module catalogue and the module explorer use. That is deliberate: these are one
 * interaction, and three implementations of it would behave almost identically, which is worse than
 * behaving differently on purpose.
 */
export const CommandPalette = ({ open, onClose }: CommandPaletteProps) => {
  if (!open) return null;

  // Read on every render of an open palette rather than memoised.
  //
  // Commands are registered after the first render and more can be registered at any point, so a list
  // computed once and cached is empty forever and every command silently unreachable — which is
  // exactly what happened. The registry is a map lookup over a few dozen entries; caching it saved
  // nothing and cost the feature.
  const items: NavigatorItem[] = commandRegistry.runnable().map((command) => ({
    id: command.id,
    label: command.name,
    hint: command.id,
    group: command.category,
    keywords: command.description,
  }));

  return (
    <Modal open={open} onClose={onClose} title="Commands" size="md">
      <SearchableTreeNavigator
        items={items}
        autoFocus
        placeholder="Type a command"
        ariaLabel="Search commands"
        emptyMessage="No matching command"
        onChoose={(item) => {
          onClose();
          void commandRegistry.dispatch(item.id);
        }}
      />
    </Modal>
  );
};
