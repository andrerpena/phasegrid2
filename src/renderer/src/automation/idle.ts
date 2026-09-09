import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { flushSync } from "@renderer/patch/engine-sync";

/**
 * Resolves when the application has nothing in flight.
 *
 * "Nothing" means: every document edit has reached the engine, the catalogue is not mid-load, the
 * telemetry subscription that queues behind an edit has been answered, and the screen has painted
 * twice since. It is the replacement for `sleep(400)` in a script: a wait that ends when the thing
 * has happened rather than when a guess about how long it takes runs out.
 *
 * What it does not cover: a settings save in flight (small, and a file read after it is the
 * only thing that would notice), and animations. `waitFor` is for those.
 */
export interface IdleDeps {
  flush(): Promise<void>;
  catalogLoading(): boolean;
  frame(): Promise<void>;
  sleep(ms: number): Promise<void>;
}

const real: IdleDeps = {
  flush: flushSync,
  catalogLoading: () => useCatalogStore.getState().status === "loading",
  frame: () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export async function idle(deps: IdleDeps = real): Promise<void> {
  // The catalogue first: a load in progress ends with a resync of the canvas and the telemetry set,
  // which lands on the queue flushed below.
  for (let i = 0; i < 200 && deps.catalogLoading(); i++) await deps.sleep(25);
  // Twice, because the first flush can enqueue more: telemetry resubscribes behind the edit it
  // reacts to, and `afterSync` callers add to the same queue.
  await deps.flush();
  await deps.flush();
  await deps.frame();
  await deps.frame();
}

/** Polls `predicate` until it is true, or throws after `timeoutMs`. */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
  sleep: (ms: number) => Promise<void> = real.sleep,
): Promise<void> {
  const timeout = options.timeoutMs ?? 5000;
  const interval = options.intervalMs ?? 50;
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeout)
      throw new Error(
        `waitFor: ${options.label ?? "the condition"} did not happen within ${timeout} ms`,
      );
    await sleep(interval);
  }
}
