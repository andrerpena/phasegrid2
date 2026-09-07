import type { ReactNode } from "react";
import styles from "./Panel.module.css";

export interface PanelProps {
  title: string;
  /** Buttons in the title bar. */
  actions?: ReactNode;
  children: ReactNode;
  /**
   * The keybinding focus region for anything inside. A binding scoped to this name applies while focus
   * is here, which is how a widget overrides a global shortcut.
   */
  scope?: string;
}

/** A titled region. The unit a widget occupies in the dock. */
export const Panel = ({ title, actions, children, scope }: PanelProps) => (
  <section className={styles.root} data-kb-scope={scope}>
    <header className={styles.header}>
      <h2 className={styles.title}>{title}</h2>
      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
    </header>
    <div className={styles.body}>{children}</div>
  </section>
);
