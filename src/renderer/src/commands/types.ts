/**
 * Commands: one name for every action the application can take.
 *
 * A menu item, a keystroke, the command palette and a button all dispatch the same command rather than
 * each calling the underlying function. That is what makes a keybindings file possible, and what stops
 * an action from behaving differently depending on how it was reached.
 *
 * A command with `execute` can be run. One without is a notification: something happened, and anything
 * interested may subscribe. Both live in one registry because the alternative is two systems that have
 * to be kept in step.
 */

export type CommandId = string;

/** What a command's `execute` receives. Deliberately small; a command reaches stores directly. */
export interface CommandContext {
  dispatch: (id: CommandId, payload?: unknown) => void | Promise<void>;
}

export interface CommandDefinition<TPayload = void> {
  id: CommandId;
  name: string;
  description?: string;
  /** Grouping in the palette. */
  category?: string;
  /**
   * Kept out of the command palette. For commands that need a payload no person would type, like a
   * parameter change carrying a node id and a float.
   */
  hidden?: boolean;
  execute?: (
    context: CommandContext,
    payload: TPayload,
  ) => void | Promise<void>;
}

export type CommandHandler<TPayload = unknown> = (payload: TPayload) => void;
