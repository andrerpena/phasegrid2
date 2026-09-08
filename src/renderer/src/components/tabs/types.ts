import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Visual variant for the tabs
 * - primary: VS Code main editor style (prominent, for file tabs)
 * - secondary: Faded style for side panels
 */
export type TabVariant = "primary" | "secondary";

/**
 * Individual tab item configuration
 */
export interface TabItem {
  /** Unique identifier for the tab */
  id: string;
  /** Display label for the tab */
  label: string;
  /** Optional Lucide icon component */
  icon?: LucideIcon;
  /** Whether the tab can be closed (shows X button) */
  closable?: boolean;
  /** Whether the tab has unsaved changes (shows dot indicator) */
  dirty?: boolean;
  /** Content to render when this tab is active */
  content: ReactNode;
  /** Optional context menu items rendered in a dropdown on the tab */
  contextMenu?: ReactNode;
  /**
   * If false, the tab panel uses overflow:hidden instead of overflow-y-auto.
   * Default true. Set false for canvas widgets that fill their slot exactly
   * and should never scroll (otherwise pixel-rounding overflow flickers a
   * scrollbar in and out).
   */
  scrollable?: boolean;
}

/**
 * Props for the Tab component (individual tab button)
 */
export interface TabProps {
  /** Tab configuration */
  tab: TabItem;
  /** Whether this tab is currently active */
  isActive: boolean;
  /** Visual variant */
  variant: TabVariant;
  /** Callback when tab is clicked */
  onSelect: (id: string) => void;
  /** Callback when close button is clicked */
  onClose?: (id: string) => void;
}

/**
 * Props for the Tabs container component
 */
export interface TabsProps {
  /** Array of tab configurations */
  tabs: TabItem[];
  /** ID of the currently active tab (controlled mode) */
  activeTabId?: string;
  /** Default active tab ID (uncontrolled mode) */
  defaultActiveTabId?: string;
  /** Callback when active tab changes */
  onTabChange?: (tabId: string) => void;
  /** Callback when a tab is closed */
  onTabClose?: (tabId: string) => void;
  /** Visual variant for all tabs */
  variant?: TabVariant;
  /** Additional className for the container */
  className?: string;
  /**
   * Keep all tab panels mounted when switching tabs.
   * Inactive panels are hidden with CSS instead of unmounting.
   * Useful for tabs with expensive initialization (e.g., canvases, editors).
   * @default false
   */
  keepMounted?: boolean;
  /** Optional trailing element rendered at the end of the tab list (e.g., settings icon) */
  trailingAction?: ReactNode;
}
