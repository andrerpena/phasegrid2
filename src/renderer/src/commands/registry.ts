import type {
  CommandContext,
  CommandDefinition,
  CommandHandler,
  CommandId,
} from "./types";

/**
 * The command registry: definitions in, dispatches out, subscribers notified.
 *
 * Dispatching a command nobody registered is a warning rather than an error, because a notification
 * with no listeners is a perfectly ordinary thing and refusing it would make every optional feature
 * into a required one.
 */
export class CommandRegistry {
  private readonly commands = new Map<CommandId, CommandDefinition<never>>();
  private readonly handlers = new Map<CommandId, Set<CommandHandler>>();
  private readonly anyHandlers = new Set<
    (id: CommandId, payload: unknown) => void
  >();
  /** Reported rather than thrown, so a failing command cannot take the window down with it. */
  onError: (id: CommandId, error: unknown) => void = () => {};

  register<TPayload>(command: CommandDefinition<TPayload>): void {
    this.commands.set(command.id, command as CommandDefinition<never>);
  }

  registerAll(commands: CommandDefinition<never>[]): void {
    for (const command of commands) this.register(command);
  }

  get(id: CommandId): CommandDefinition<never> | undefined {
    return this.commands.get(id);
  }

  /** Everything registered, for the palette and for tests. */
  all(): CommandDefinition<never>[] {
    return [...this.commands.values()];
  }

  /** What the palette offers: runnable, and not hidden. */
  runnable(): CommandDefinition<never>[] {
    return this.all().filter(
      (c) => c.execute !== undefined && c.hidden !== true,
    );
  }

  on<TPayload>(id: CommandId, handler: CommandHandler<TPayload>): () => void {
    const set = this.handlers.get(id) ?? new Set();
    set.add(handler as CommandHandler);
    this.handlers.set(id, set);
    return () => set.delete(handler as CommandHandler);
  }

  /** Every dispatch, for logging and for the history widget. */
  onAny(handler: (id: CommandId, payload: unknown) => void): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  async dispatch(id: CommandId, payload?: unknown): Promise<void> {
    // Subscribers first, and always, whether or not anything executes. A notification is the case where
    // there is nothing to execute, and it must still reach the things watching for it.
    for (const handler of [...(this.handlers.get(id) ?? [])]) {
      try {
        handler(payload);
      } catch (error) {
        this.onError(id, error);
      }
    }
    for (const handler of [...this.anyHandlers]) {
      try {
        handler(id, payload);
      } catch (error) {
        this.onError(id, error);
      }
    }

    const command = this.commands.get(id);
    if (command?.execute === undefined) return;
    const context: CommandContext = {
      dispatch: (next, p) => this.dispatch(next, p),
    };
    try {
      await command.execute(context, payload as never);
    } catch (error) {
      // A command that throws is a bug in that command, not a reason to lose the window.
      this.onError(id, error);
    }
  }

  clear(): void {
    this.commands.clear();
    this.handlers.clear();
    this.anyHandlers.clear();
  }
}

/** The application's registry. Commands register into it at startup. */
export const commandRegistry = new CommandRegistry();
