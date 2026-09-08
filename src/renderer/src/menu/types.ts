import type React from "react";

/**
 * Standard icon type used throughout the interface.
 * Icons are passed as component types (not instantiated) for consistency and flexibility.
 */
export type IconComponent = React.ComponentType<{
  size?: number | string;
  className?: string;
}>;

/**
 * Unified menu item type that works for main navigation, command palettes,
 * global actions, and any other menu-like UI.
 */
export interface MenuItem {
  id: string;

  /**
   * Display label for the menu item.
   */
  label?: string;

  /**
   * Optional subtitle/description shown below the label.
   */
  subtitle?: string;

  /**
   * Icon component (not instantiated).
   */
  icon?: IconComponent;

  /**
   * Optional right-aligned hint shown next to the label. Used for things
   * like keybinding shortcuts (`⌘C`, `Ctrl+Z`). Styled as muted caption
   * text. String only — keep it simple.
   */
  trailing?: string;

  /**
   * Free text the search also matches, beyond the label and the subtitle: a module's description,
   * a command's category. Weighted well below a name match -- see `command-palette/rank.ts`.
   */
  keywords?: string;

  /**
   * Whether the menu item is disabled.
   */
  disabled?: boolean;

  /**
   * Visual variant for the menu item.
   */
  variant?: "default" | "destructive";

  /**
   * Direct handler function for simple actions.
   */
  onExecute?: () => void | Promise<void>;

  /**
   * Callback when this item receives focus (via keyboard navigation).
   * Useful for preview effects (e.g., theme preview on hover/focus).
   */
  onFocus?: () => void;

  /**
   * Child menu items for hierarchical menus.
   * When present, the item acts as a parent/folder.
   */
  children?: MenuItem[];
}

/**
 * Menu item or separator literal for creating grouped menus.
 */
export type MenuItemOrSeparator = MenuItem | "separator";
