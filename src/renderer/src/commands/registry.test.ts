import { describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "./registry";

describe("the command registry", () => {
  it("runs a registered command", async () => {
    const r = new CommandRegistry();
    const run = vi.fn();
    r.register({ id: "test.go", name: "Go", execute: run });
    await r.dispatch("test.go", { value: 1 });
    expect(run).toHaveBeenCalledWith(expect.anything(), { value: 1 });
  });

  it("notifies subscribers whether or not anything executes", async () => {
    // A notification is the case where there is nothing to execute. It must still reach its listeners,
    // or every optional feature becomes a required one.
    const r = new CommandRegistry();
    const heard = vi.fn();
    r.on("patch.changed", heard);
    await r.dispatch("patch.changed", { revision: 3 });
    expect(heard).toHaveBeenCalledWith({ revision: 3 });
  });

  it("keeps running when a subscriber throws", async () => {
    const r = new CommandRegistry();
    const errors: unknown[] = [];
    r.onError = (_id, error) => errors.push(error);
    const second = vi.fn();
    r.on("x", () => {
      throw new Error("bad listener");
    });
    r.on("x", second);
    await r.dispatch("x");
    expect(second).toHaveBeenCalled();
    expect(errors).toHaveLength(1);
  });

  it("reports a command that throws rather than letting it escape", async () => {
    // A failing command is a bug in that command, not a reason to lose the window.
    const r = new CommandRegistry();
    const errors: string[] = [];
    r.onError = (id) => errors.push(id);
    r.register({
      id: "test.explode",
      name: "Explode",
      execute: () => {
        throw new Error("boom");
      },
    });
    await expect(r.dispatch("test.explode")).resolves.toBeUndefined();
    expect(errors).toEqual(["test.explode"]);
  });

  it("lets a command dispatch another", async () => {
    const r = new CommandRegistry();
    const inner = vi.fn();
    r.register({ id: "inner", name: "Inner", execute: inner });
    r.register({
      id: "outer",
      name: "Outer",
      execute: (context) => context.dispatch("inner"),
    });
    await r.dispatch("outer");
    expect(inner).toHaveBeenCalled();
  });

  it("offers only runnable, unhidden commands to the palette", () => {
    const r = new CommandRegistry();
    r.register({ id: "a", name: "A", execute: () => {} });
    r.register({ id: "b", name: "B", execute: () => {}, hidden: true });
    r.register({ id: "c", name: "C" }); // a notification
    expect(r.runnable().map((c) => c.id)).toEqual(["a"]);
  });

  it("stops calling a subscriber that unsubscribed", async () => {
    const r = new CommandRegistry();
    const heard = vi.fn();
    const stop = r.on("x", heard);
    stop();
    await r.dispatch("x");
    expect(heard).not.toHaveBeenCalled();
  });

  it("tells the any-listener about every dispatch, including unregistered ones", async () => {
    const r = new CommandRegistry();
    const seen: string[] = [];
    r.onAny((id) => seen.push(id));
    r.register({ id: "known", name: "Known", execute: () => {} });
    await r.dispatch("known");
    await r.dispatch("never.registered");
    expect(seen).toEqual(["known", "never.registered"]);
  });
});
