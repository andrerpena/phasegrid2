// =============================================================================
// SCHEMA ACTIONS
// =============================================================================

import type { IconComponent } from "../../menu/types";

/**
 * Definition of an action that can be attached to a schema.
 * Actions trigger commands when executed.
 */
export interface SchemaAction {
  /** Unique identifier for the action */
  id: string;
  /** Display label for the action */
  label: string;
  /** Optional icon component */
  icon?: IconComponent;
  /** Command ID to execute (e.g., "character.select", "character.focus") */
  commandId: string;
  /**
   * How to map the entity to command arguments.
   * Can be a string (field name to use as the argument) or a function.
   */
  argsMapper?: string | ((entity: unknown) => unknown);
  /** Whether this action requires selection (default: false) */
  requiresSelection?: boolean;
  /** Whether to show in row context menu (default: true) */
  showInRowMenu?: boolean;
  /** Whether to show in header toolbar (default: false) */
  showInToolbar?: boolean;
}

/**
 * Schema-level action configuration
 */
export interface SchemaActionsConfig {
  /** Primary action ID (triggered on double-click) */
  primaryAction?: string;
  /** All available actions */
  actions: SchemaAction[];
}
