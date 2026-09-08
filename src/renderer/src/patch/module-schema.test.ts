import { descriptor } from "@renderer/grid/fixtures";
import { ParamUnitSchema } from "@shared/protocol/catalog";
import { describe, expect, it } from "vitest";
import {
  buildModuleSchema,
  flattenModule,
  inspectableParams,
  numericValue,
  PARAM_PREFIX,
  paramIdFor,
} from "./module-schema";

const osc = descriptor("osc.wavetable");
const vca = descriptor("amp.vca");

describe("the form a module gets", () => {
  it("carries identity, uneditable", () => {
    const shape = buildModuleSchema(vca).getShape();
    expect(shape.id._meta.editable).toBe(false);
    expect(shape.type._meta.editable).toBe(false);
    expect(shape.name._meta.editable).toBe(false);
  });

  it("has one field per parameter the engine declares", () => {
    const schema = buildModuleSchema(osc);
    for (const param of inspectableParams(osc)) {
      const field = schema.getFieldSchema(`${PARAM_PREFIX}${param.id}`);
      expect(field, param.id).toBeDefined();
      expect(field._meta.label, param.id).toBe(param.name);
    }
  });

  it("leaves out what the engine says to hide", () => {
    // No module in the golden catalogue has a hidden parameter yet, so this marks one hidden and
    // checks it disappears. Filtering against a set that happens to be empty proves nothing.
    const shown = inspectableParams(vca)[0];
    const withHidden = {
      ...vca,
      params: vca.params.map((p) =>
        p.id === shown.id ? { ...p, flags: { ...p.flags, hidden: true } } : p,
      ),
    };
    expect(inspectableParams(withHidden)).toHaveLength(vca.params.length - 1);
    expect(buildModuleSchema(withHidden).getFieldKeys()).not.toContain(
      `${PARAM_PREFIX}${shown.id}`,
    );
  });

  it("has a suffix for every unit the engine can declare", () => {
    // A unit added to the engine and missed here shows a bare number, which reads as a ratio
    // whatever it actually is.
    for (const unit of ParamUnitSchema.options) {
      const field = buildModuleSchema({
        ...vca,
        params: [
          {
            ...vca.params[0],
            id: "u",
            flags: { ...vca.params[0].flags, enum: false },
            unit,
          },
        ],
      }).getFieldSchema(`${PARAM_PREFIX}u`);
      // `none` is the one that legitimately adds nothing.
      if (unit === "none") expect(field._meta.unit).toBeUndefined();
      else expect(field._meta.unit, unit).toBeTruthy();
    }
  });

  it("prefixes parameter keys, so a parameter called `name` cannot collide", () => {
    // A module may name a parameter whatever it likes; a collision would silently show the wrong
    // value in one of the two places.
    expect(paramIdFor(`${PARAM_PREFIX}level`)).toBe("level");
    expect(paramIdFor("name")).toBeNull();
  });

  it("shows a unit after a value that has one", () => {
    const withUnit = inspectableParams(osc).find((p) => p.unit !== "none");
    expect(withUnit, "the fixture has no parameter with a unit").toBeDefined();
    if (withUnit === undefined) return;
    const field = buildModuleSchema(osc).getFieldSchema(
      `${PARAM_PREFIX}${withUnit.id}`,
    );
    expect(field._meta.unit).toBeTruthy();
  });

  it("renders an enum as a dropdown of its own labels", () => {
    const enumParam = inspectableParams(osc).find((p) => p.flags.enum);
    expect(enumParam, "the fixture has no enum parameter").toBeDefined();
    if (enumParam === undefined) return;
    const field = buildModuleSchema(osc).getFieldSchema(
      `${PARAM_PREFIX}${enumParam.id}`,
    );
    expect(field._meta.renderer).toBe("enum");
    expect(field._meta.enumValues?.map((e) => e.label)).toEqual(
      enumParam.enumLabels,
    );
  });

  it("does not offer to edit a structural parameter", () => {
    const structural = inspectableParams(osc).find((p) => p.flags.structural);
    expect(structural, "the fixture has no structural parameter").toBeDefined();
    if (structural === undefined) return;
    const field = buildModuleSchema(osc).getFieldSchema(
      `${PARAM_PREFIX}${structural.id}`,
    );
    expect(field._meta.editable).toBe(false);
  });
});

describe("the values it is filled with", () => {
  it("uses the descriptor's default for a parameter never set", () => {
    const view = flattenModule({ id: "m1", type: vca.id }, vca);
    const first = inspectableParams(vca).find((p) => !p.flags.enum);
    if (first === undefined) return;
    expect(view[`${PARAM_PREFIX}${first.id}`]).toBe(first.default);
  });

  it("uses the module's own value when it has one", () => {
    const first = inspectableParams(vca).find((p) => !p.flags.enum);
    if (first === undefined) return;
    const view = flattenModule(
      { id: "m1", type: vca.id, params: { [first.id]: first.min } },
      vca,
    );
    expect(view[`${PARAM_PREFIX}${first.id}`]).toBe(first.min);
  });

  it("shows an enum as its label rather than its index", () => {
    const enumParam = inspectableParams(osc).find((p) => p.flags.enum);
    if (enumParam === undefined) return;
    const view = flattenModule(
      { id: "m1", type: osc.id, params: { [enumParam.id]: 1 } },
      osc,
    );
    expect(view[`${PARAM_PREFIX}${enumParam.id}`]).toBe(
      enumParam.enumLabels?.[1],
    );
  });
});

describe("turning an edit back into a number", () => {
  const level = inspectableParams(vca).find(
    (p) => !p.flags.enum && !p.flags.integer,
  );

  it("has a continuous parameter to work with", () => {
    // Every case below early-returns without one, so this is what keeps them from passing vacuously.
    expect(level).toBeDefined();
  });

  it("keeps a value inside the parameter's range", () => {
    if (level === undefined) return;
    expect(numericValue(level, level.max + 100)).toBe(level.max);
    expect(numericValue(level, level.min - 100)).toBe(level.min);
  });

  it("falls back to the default rather than to zero", () => {
    // Zero is not in range for a parameter like 20..20000, so a bad edit must not produce it.
    if (level === undefined) return;
    expect(numericValue(level, "not a number")).toBe(level.default);
    expect(numericValue(level, Number.NaN)).toBe(level.default);
  });

  it("rounds an integer parameter", () => {
    const integer = osc.params.find((p) => p.flags.integer && !p.flags.enum);
    expect(integer, "the fixture has no integer parameter").toBeDefined();
    if (integer === undefined) return;
    expect(Number.isInteger(numericValue(integer, integer.min + 0.4))).toBe(
      true,
    );
  });

  it("maps an enum's label back to its index", () => {
    const enumParam = inspectableParams(osc).find((p) => p.flags.enum);
    if (enumParam === undefined || enumParam.enumLabels === undefined) return;
    expect(numericValue(enumParam, enumParam.enumLabels[1])).toBe(1);
    expect(numericValue(enumParam, "nonesuch")).toBe(enumParam.default);
  });

  it("accepts a numeric string, because a form field yields text", () => {
    if (level === undefined) return;
    const inside = (level.min + level.max) / 2;
    expect(numericValue(level, String(inside))).toBeCloseTo(inside, 6);
  });
});
