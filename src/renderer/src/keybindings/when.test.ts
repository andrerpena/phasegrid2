import { describe, expect, it } from "vitest";
import { compileWhen, evaluateWhen } from "./when";

const grid = {
  focus: "grid",
  modalOpen: false,
  hasSelection: true,
  engineReady: true,
};

describe("when clauses", () => {
  it("reads a boolean straight out of the context", () => {
    expect(evaluateWhen("engineReady", grid)).toBe(true);
    expect(evaluateWhen("modalOpen", grid)).toBe(false);
  });

  it("compares a string", () => {
    expect(evaluateWhen('focus == "grid"', grid)).toBe(true);
    expect(evaluateWhen('focus == "inspector"', grid)).toBe(false);
    expect(evaluateWhen('focus != "inspector"', grid)).toBe(true);
  });

  it("negates", () => {
    expect(evaluateWhen("!modalOpen", grid)).toBe(true);
    expect(evaluateWhen("!engineReady", grid)).toBe(false);
  });

  it("combines with and, and with or", () => {
    expect(evaluateWhen('focus == "grid" && hasSelection', grid)).toBe(true);
    expect(evaluateWhen('focus == "logs" || hasSelection', grid)).toBe(true);
    expect(evaluateWhen('focus == "logs" && hasSelection', grid)).toBe(false);
  });

  it("binds and tighter than or, as the arithmetic of it suggests", () => {
    // false && false || true is true only if && binds first. Getting this backwards would make a
    // keybinding fire in a context its author meant to exclude, which is worse than not firing.
    expect(evaluateWhen("modalOpen && modalOpen || engineReady", grid)).toBe(
      true,
    );
  });

  it("groups with parentheses", () => {
    expect(evaluateWhen("modalOpen && (modalOpen || engineReady)", grid)).toBe(
      false,
    );
  });

  it("treats a key the context does not have as false rather than an error", () => {
    // Contexts grow. An old keybindings file mentioning a key this build dropped should be inert, not
    // stop the application from starting.
    expect(evaluateWhen("someKeyFromTheFuture", grid)).toBe(false);
    expect(evaluateWhen('someKeyFromTheFuture == "x"', grid)).toBe(false);
  });

  it("is false when the clause does not parse, rather than throwing at a keystroke", () => {
    expect(evaluateWhen('focus == "grid', grid)).toBe(false);
    expect(evaluateWhen("focus &&", grid)).toBe(false);
    expect(evaluateWhen("focus $$ grid", grid)).toBe(false);
  });

  it("compiles once so a keystroke does not re-parse", () => {
    const clause = compileWhen('focus == "grid" && !modalOpen');
    expect(clause(grid)).toBe(true);
    expect(clause({ ...grid, modalOpen: true })).toBe(false);
  });

  it("reports where a broken clause went wrong when compiled directly", () => {
    // `evaluateWhen` swallows this on purpose; compiling is how a settings editor shows the problem.
    expect(() => compileWhen('focus == "grid')).toThrow(/unterminated string/);
  });
});
