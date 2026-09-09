import {
  type ObjectSchema,
  type ObjectShape,
  schema,
} from "@renderer/schemas/core/schema";
import type {
  ModuleDescriptor,
  ParamDesc,
  TextDesc,
} from "@shared/protocol/catalog";
import type { PatchModule } from "@shared/protocol/patch";
import { paramValue } from "./params";

/**
 * A module's inspector form, built from the engine's own descriptors.
 *
 * Nothing about a particular module appears here. Every field, its label, its range, its unit and
 * whether it is a dropdown or a number all come from `ModuleDescriptor`, which is what the engine
 * prints — so adding a module to the engine gives it a working inspector with no change to the
 * interface, which is the same promise `composeFace` makes for the canvas.
 *
 * Hidden parameters are left out, and structural ones are shown but not editable: the engine rebuilds
 * a node to change one, which is not something to offer through a form field that looks like every
 * other field.
 */

/** What the inspector shows: identity, then one entry per parameter. */
export interface ModuleInspectorView {
  id: string;
  type: string;
  name: string;
  [param: string]: string | number;
}

/**
 * The label a unit adds after a value. `none` adds nothing rather than the word "none".
 *
 * Every member of `ParamUnit` has an entry, and a test asserts that -- a unit added to the engine
 * and missed here would silently show a number with nothing after it, which reads as a ratio
 * whatever it actually is.
 */
const UNIT_SUFFIX: Record<ParamDesc["unit"], string> = {
  none: "",
  hz: "Hz",
  seconds: "s",
  db: "dB",
  semitones: "st",
  percent: "%",
  ratio: "×",
};

/** Parameters worth showing, in the order the engine declared them. */
export function inspectableParams(descriptor: ModuleDescriptor): ParamDesc[] {
  return descriptor.params.filter((p) => !p.flags.hidden);
}

/**
 * The values, flattened onto one object.
 *
 * Keys are prefixed so a parameter called `id` or `name` cannot collide with the identity fields —
 * a module is free to name a parameter whatever it likes, and a collision would silently show the
 * wrong value in one of the two places.
 */
export const PARAM_PREFIX = "param:";
/** The same, for a module's text properties, which live in the node's `data` rather than in params. */
export const TEXT_PREFIX = "text:";

export function flattenModule(
  module: PatchModule,
  descriptor: ModuleDescriptor,
): ModuleInspectorView {
  const view: ModuleInspectorView = {
    id: module.id,
    type: descriptor.id,
    name: descriptor.name,
  };
  for (const param of inspectableParams(descriptor)) {
    const value = paramValue(module, descriptor, param.id);
    view[`${PARAM_PREFIX}${param.id}`] = param.flags.enum
      ? (param.enumLabels?.[Math.round(value)] ?? String(value))
      : value;
  }
  // A text property's value is in the node's `data` under its own id, falling back to the default
  // the module declared -- the same rule `configure` follows in the engine.
  for (const text of descriptor.texts) {
    const value = module.data?.[text.id];
    view[`${TEXT_PREFIX}${text.id}`] =
      typeof value === "string" ? value : text.default;
  }
  return view;
}

export function buildModuleSchema(
  descriptor: ModuleDescriptor,
  /** What the expand button on a text field does. Absent leaves the field a plain one-liner. */
  onExpandText?: (text: TextDesc) => void,
): ObjectSchema<ObjectShape> {
  const shape: ObjectShape = {
    id: schema.string().withMetadata({ label: "ID", editable: false }),
    type: schema.string().withMetadata({ label: "Type", editable: false }),
    name: schema.string().withMetadata({ label: "Module", editable: false }),
  };

  for (const param of inspectableParams(descriptor)) {
    const key = `${PARAM_PREFIX}${param.id}`;
    const unit = UNIT_SUFFIX[param.unit];
    // Structural parameters are read-only: changing one makes the engine rebuild the node, which is
    // not something to offer behind a field that looks like every other field.
    const editable = !param.flags.structural;

    if (param.flags.enum) {
      shape[key] = schema.string().withMetadata({
        label: param.name,
        description: param.doc,
        editable,
        renderer: "enum",
        // The label is both what is shown and what is stored in the form; `numericValue` turns it
        // back into the index the document holds. Keeping the form in labels means the renderer
        // never has to be told how to map one to the other.
        enumValues: (param.enumLabels ?? []).map((label) => ({
          label,
          value: label,
        })),
      });
      continue;
    }

    shape[key] = schema.number().withMetadata({
      label: param.name,
      description: param.doc,
      editable,
      ...(unit === "" ? {} : { unit }),
      defaultValue: param.default,
      // The range, so the field holds `1` and `13` on the way to `137` rather than handing on a
      // value the parameter cannot take. `numericValue` still clamps as the last line.
      min: param.min,
      max: param.max,
      integer: param.flags.integer,
    });
  }

  for (const text of descriptor.texts) {
    // `renderer: "code"` rather than `"pattern"`: the field is a string a module owns, and which
    // language it is written in is the module's business, not the form's. A renderer that does not
    // know the language falls back to a plain field, so a new language costs colouring, not typing.
    shape[`${TEXT_PREFIX}${text.id}`] = schema.string().withMetadata({
      label: text.name,
      description: text.doc,
      renderer: "code",
      language: text.language,
      placeholder: text.placeholder,
      multiline: text.flags.multiline,
      defaultValue: text.default,
      ...(onExpandText === undefined
        ? {}
        : { onExpand: () => onExpandText(text) }),
    });
  }

  return schema.object(shape);
}

/** Turns an edited form key back into the parameter it names, or null for an identity field. */
export function paramIdFor(key: string): string | null {
  return key.startsWith(PARAM_PREFIX) ? key.slice(PARAM_PREFIX.length) : null;
}

/** Turns an edited form key back into the text property it names, or null. */
export function textIdFor(key: string): string | null {
  return key.startsWith(TEXT_PREFIX) ? key.slice(TEXT_PREFIX.length) : null;
}

/**
 * The number to store for a value the form produced.
 *
 * An enum field yields a label, because that is what it displays; the document stores the index.
 * Anything the descriptor does not recognise falls back to the parameter's default rather than to
 * zero, which for a range like 20..20000 is not a value the parameter can hold.
 */
export function numericValue(param: ParamDesc, value: unknown): number {
  if (param.flags.enum) {
    const index = (param.enumLabels ?? []).indexOf(String(value));
    return index < 0 ? param.default : index;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return param.default;
  const clamped = Math.min(param.max, Math.max(param.min, numeric));
  return param.flags.integer ? Math.round(clamped) : clamped;
}
