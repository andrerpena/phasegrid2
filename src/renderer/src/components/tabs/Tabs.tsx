import { type ReactNode, useId } from "react";
import styles from "./Tabs.module.css";

export interface TabDefinition {
  id: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  tabs: TabDefinition[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Buttons in the tab strip, right-aligned. */
  actions?: ReactNode;
}

/**
 * A tab strip with one panel showing.
 *
 * Arrow keys move between tabs and only the active tab is reachable by tabbing, which is how a tab list
 * is expected to behave: pressing tab should leave the strip and land in the panel, not walk through
 * every tab first.
 */
export const Tabs = ({ tabs, activeId, onSelect, actions }: TabsProps) => {
  const baseId = useId();
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const move = (delta: number) => {
    const index = tabs.findIndex((t) => t.id === active?.id);
    if (index < 0) return;
    // Wrapping, so the last tab's right arrow reaches the first rather than doing nothing.
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next !== undefined) onSelect(next.id);
  };

  return (
    <div className={styles.root}>
      <div className={styles.strip} role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${baseId}-${tab.id}-tab`}
            aria-selected={tab.id === active?.id}
            aria-controls={`${baseId}-${tab.id}-panel`}
            tabIndex={tab.id === active?.id ? 0 : -1}
            className={styles.tab}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(1);
              }
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(-1);
              }
            }}
          >
            {tab.label}
          </button>
        ))}
        {actions !== undefined && (
          <div className={styles.actions}>{actions}</div>
        )}
      </div>
      {active !== undefined && (
        <div
          role="tabpanel"
          id={`${baseId}-${active.id}-panel`}
          aria-labelledby={`${baseId}-${active.id}-tab`}
          className={styles.panel}
        >
          {active.content}
        </div>
      )}
    </div>
  );
};
