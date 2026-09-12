import { SearchableTreeNavigator } from "@renderer/components/command-palette";
import { ModalFrame, useModalStore } from "@renderer/components/floating/modal";
import type { MenuItem } from "@renderer/menu/types";
import { rememberTheme, useThemeStore } from "@renderer/theming/theme-store";
import { Moon, Palette, Sun } from "lucide-react";
import type { CommandDefinition } from "../types";

/**
 * Pick a theme, and see it while you pick.
 *
 * Arrowing through the list repaints the window on every step, because a theme is a thing you judge
 * by looking at it rather than by reading its name. Escaping puts back the one you had — that is what
 * `onDismiss` is for, and why the modal store distinguishes backing out from closing.
 *
 * The current theme is listed first so the list opens on where you already are.
 */
export const workbenchSetTheme: CommandDefinition<never> = {
  id: "workbench.setTheme",
  name: "Set Theme",
  category: "Workbench",
  execute: () => {
    const { setTheme } = useThemeStore.getState();
    const original = useThemeStore.getState().theme.id;
    // Read from the store, not from the built-in list: a workspace can define its own themes and
    // they belong in the picker beside the ones that shipped.
    const themes = useThemeStore.getState().available;

    const ordered = [
      ...themes.filter((t) => t.id === original),
      ...themes
        .filter((t) => t.id !== original)
        .sort((a, b) => a.name.localeCompare(b.name)),
    ];

    const items: MenuItem[] = ordered.map((theme) => ({
      id: theme.id,
      label: theme.name,
      subtitle: theme.id,
      icon: theme.type === "dark" ? Moon : Sun,
      // Choosing closes without dismissing, so the preview stands -- and only choosing writes the
      // setting, because arrowing through the list would otherwise put a dozen entries through the
      // save path for one decision.
      onExecute: () => {
        setTheme(theme.id);
        rememberTheme(theme.id);
        useModalStore.getState().closeAllModals();
      },
      onFocus: () => setTheme(theme.id),
    }));

    useModalStore.getState().openModal({
      alignment: "top",
      size: "lg",
      content: (
        <ModalFrame data-testid="theme-picker">
          <SearchableTreeNavigator
            items={items}
            placeHolder="Search themes…"
            selectedItemId={original}
            autoFocusInput
            data-testid="theme-picker-navigator"
          />
        </ModalFrame>
      ),
      onDismiss: () => setTheme(original),
    });
  },
};

/** The icon the palette shows beside it. Kept with the command so both agree. */
export const SET_THEME_ICON = Palette;
