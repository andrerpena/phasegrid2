// =============================================================================
// SCHEMA SYSTEM (ADAPTED FROM NUBASE)
// =============================================================================

import { z } from "zod";
import type { SchemaAction, SchemaActionsConfig } from "./actions";

/**
 * Metadata attached to schema fields for UI rendering
 */
export interface SchemaMetadata<Output = unknown> {
  /** Display label for the field */
  label?: string;
  /** Help text / description */
  description?: string;
  /** Default value for the field */
  defaultValue?: Output;
  /**
   * Custom renderer identifier to override type-based rendering.
   * Examples: "readonly", "enum", "color", "slider"
   */
  renderer?: string;
  /** For enum renderer - list of possible values */
  enumValues?: Array<{ label: string; value: unknown }>;
  /** Unit suffix to display (e.g., "px", "%", "C") */
  unit?: string;
  /**
   * The range a number field holds, and whether only whole numbers are values. The field uses them
   * to decide which of the things typed on the way to a number are worth handing on: see
   * `form-controls/numeric-draft.ts`.
   */
  min?: number;
  max?: number;
  integer?: boolean;
  /** Whether the field is editable (for inspector) */
  editable?: boolean;
  /**
   * Which language a `code` field is written in -- "mini" for Tidal/Strudel mini-notation, absent
   * for plain text. A renderer that does not know the name falls back to plain text, so an
   * unrecognised language costs syntax colouring rather than the ability to type.
   */
  language?: string;
  /** What to show in an empty field. */
  placeholder?: string;
  /** A `code` field the editor should open as a block of lines rather than as one. */
  multiline?: boolean;
  /**
   * What the expand button on a `code` field does. Supplied by whoever built the schema, so the
   * form stays free of what a module's language is and of the editor that understands it.
   */
  onExpand?: () => void;

  // Validation functions (use unknown for parameter to allow covariant usage in ObjectShape)
  /** Sync validation on form submit */
  validateOnSubmit?: (value: unknown) => string | undefined;
  /** Async validation on form submit */
  validateOnSubmitAsync?: (value: unknown) => Promise<string | undefined>;
  /** Sync validation on blur */
  validateOnBlur?: (value: unknown) => string | undefined;
  /** Async validation on blur */
  validateOnBlurAsync?: (value: unknown) => Promise<string | undefined>;
}

/**
 * Base class for all schema types
 */
export abstract class BaseSchema<Output = unknown> {
  /**
   * Phantom property for TypeScript type inference.
   * Does not exist at runtime.
   */
  readonly _outputType!: Output;

  /**
   * The type identifier for this schema.
   * Used for type-based form field rendering.
   */
  abstract readonly type: string;

  /**
   * Get the base type, unwrapping wrappers like Optional
   */
  get baseType(): string {
    return this.type;
  }

  /**
   * Get the default value for this schema type
   */
  get defaultValue(): Output | undefined {
    return this._meta?.defaultValue;
  }

  _meta: SchemaMetadata<Output> = {};

  /**
   * Add metadata to the schema
   */
  withMetadata(meta: SchemaMetadata<Output>): this {
    this._meta = { ...this._meta, ...meta };
    return this;
  }

  /**
   * Make this schema optional
   */
  optional(): OptionalSchema<this> {
    return new OptionalSchema(this);
  }

  /**
   * Converts this schema to a Zod schema for runtime validation.
   */
  abstract toZod(): z.ZodSchema<Output>;
}

// =============================================================================
// PRIMITIVE SCHEMAS
// =============================================================================

export class BooleanSchema extends BaseSchema<boolean> {
  readonly type = "boolean" as const;

  override get defaultValue(): boolean {
    return this._meta?.defaultValue ?? false;
  }

  toZod(): z.ZodBoolean {
    return z.boolean();
  }
}

export class StringSchema extends BaseSchema<string> {
  readonly type = "string" as const;

  override get defaultValue(): string {
    return this._meta?.defaultValue ?? "";
  }

  toZod(): z.ZodString {
    return z.string();
  }
}

export class NumberSchema extends BaseSchema<number> {
  readonly type = "number" as const;

  override get defaultValue(): number {
    return this._meta?.defaultValue ?? 0;
  }

  toZod(): z.ZodNumber {
    return z.number();
  }
}

// =============================================================================
// OPTIONAL SCHEMA
// =============================================================================

export class OptionalSchema<
  TWrapped extends BaseSchema<unknown>,
> extends BaseSchema<TWrapped["_outputType"] | undefined> {
  readonly type = "optional" as const;
  _wrapped: TWrapped;

  constructor(wrapped: TWrapped) {
    super();
    this._wrapped = wrapped;
  }

  unwrap(): TWrapped {
    return this._wrapped;
  }

  override get baseType(): string {
    return this._wrapped.baseType;
  }

  override get defaultValue(): TWrapped["_outputType"] | undefined {
    return this._meta?.defaultValue ?? undefined;
  }

  toZod(): z.ZodOptional<z.ZodNullable<z.ZodSchema<TWrapped["_outputType"]>>> {
    return this._wrapped.toZod().nullable().optional();
  }
}

// =============================================================================
// OBJECT SCHEMA
// =============================================================================

/**
 * Shape of an object schema - maps keys to schemas
 */
export type ObjectShape = {
  [key: string]: BaseSchema<unknown>;
};

/**
 * Infers the TypeScript output type from an ObjectShape
 */
export type ObjectOutput<TShape extends ObjectShape> = {
  [K in keyof TShape as TShape[K] extends OptionalSchema<BaseSchema<unknown>>
    ? never
    : K]: TShape[K]["_outputType"];
} & {
  [K in keyof TShape as TShape[K] extends OptionalSchema<BaseSchema<unknown>>
    ? K
    : never]?: TShape[K]["_outputType"];
};

/**
 * Field configuration within a layout group
 */
export interface FormLayoutField<TShape extends ObjectShape> {
  name: keyof TShape;
  /** Width in grid units (1-12) */
  fieldWidth?: number;
  className?: string;
  hidden?: boolean;
}

/**
 * Group of fields within a form layout
 */
export interface FormLayoutGroup<TShape extends ObjectShape> {
  label?: string;
  description?: string;
  fields: FormLayoutField<TShape>[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

/**
 * Form layout configuration
 */
export interface FormLayout<TShape extends ObjectShape> {
  type: "form" | "grid";
  groups: FormLayoutGroup<TShape>[];
}

/**
 * Object schema for complex types
 */
export class ObjectSchema<TShape extends ObjectShape> extends BaseSchema<
  ObjectOutput<TShape>
> {
  readonly type = "object" as const;
  _shape: TShape;
  _layouts: { [name: string]: FormLayout<TShape> } = {};
  _actions: SchemaActionsConfig | null = null;

  constructor(shape: TShape) {
    super();
    this._shape = shape;
  }

  /**
   * Add form layouts to the schema
   */
  withFormLayouts(layouts: { [name: string]: FormLayout<TShape> }): this {
    this._layouts = { ...this._layouts, ...layouts };
    return this;
  }

  /**
   * Get a layout by name
   */
  getLayout(name: string): FormLayout<TShape> | undefined {
    return this._layouts[name];
  }

  /**
   * Get all layout names
   */
  getLayoutNames(): string[] {
    return Object.keys(this._layouts);
  }

  /**
   * Check if layout exists
   */
  hasLayout(name: string): boolean {
    return name in this._layouts;
  }

  /**
   * Get the shape of the object
   */
  getShape(): TShape {
    return this._shape;
  }

  /**
   * Get schema for a specific field
   */
  getFieldSchema<K extends keyof TShape>(key: K): TShape[K] {
    return this._shape[key];
  }

  /**
   * Get all field keys
   */
  getFieldKeys(): (keyof TShape)[] {
    return Object.keys(this._shape) as (keyof TShape)[];
  }

  /**
   * Add actions configuration to the schema
   */
  withActions(config: SchemaActionsConfig): this {
    this._actions = config;
    return this;
  }

  /**
   * Get actions configuration
   */
  getActions(): SchemaActionsConfig | null {
    return this._actions;
  }

  /**
   * Get a specific action by ID
   */
  getAction(actionId: string): SchemaAction | undefined {
    return this._actions?.actions.find((a) => a.id === actionId);
  }

  /**
   * Get the primary action
   */
  getPrimaryAction(): SchemaAction | undefined {
    if (!this._actions?.primaryAction) return undefined;
    return this.getAction(this._actions.primaryAction);
  }

  toZod(): z.ZodSchema<ObjectOutput<TShape>> {
    const zodShape: Record<string, z.ZodTypeAny> = {};
    for (const key in this._shape) {
      if (Object.hasOwn(this._shape, key) && this._shape[key]) {
        zodShape[key] = this._shape[key].toZod();
      }
    }
    return z.object(zodShape) as z.ZodSchema<ObjectOutput<TShape>>;
  }
}

// =============================================================================
// ARRAY SCHEMA
// =============================================================================

export type ArrayOutput<TElementSchema extends BaseSchema<unknown>> = Array<
  TElementSchema["_outputType"]
>;

export class ArraySchema<
  TElementSchema extends BaseSchema<unknown>,
> extends BaseSchema<ArrayOutput<TElementSchema>> {
  readonly type = "array" as const;
  _element: TElementSchema;

  constructor(elementSchema: TElementSchema) {
    super();
    this._element = elementSchema;
  }

  getElementSchema(): TElementSchema {
    return this._element;
  }

  toZod(): z.ZodArray<z.ZodSchema<TElementSchema["_outputType"]>> {
    return z.array(this._element.toZod());
  }
}

// =============================================================================
// TYPE UTILITIES
// =============================================================================

/**
 * Infer the TypeScript type from a schema
 */
export type Infer<T extends BaseSchema<unknown>> = T["_outputType"];

/**
 * All possible schema types
 */
export type AnySchema =
  | BooleanSchema
  | StringSchema
  | NumberSchema
  | OptionalSchema<BaseSchema<unknown>>
  | ObjectSchema<ObjectShape>
  | ArraySchema<BaseSchema<unknown>>;

// =============================================================================
// SCHEMA FACTORY
// =============================================================================

/**
 * Schema factory for creating type-safe schemas
 *
 * @example
 * ```ts
 * const userSchema = schema.object({
 *   name: schema.string().withMetadata({ label: "Name" }),
 *   age: schema.number().withMetadata({ label: "Age" }),
 *   active: schema.boolean(),
 * });
 * ```
 */
export const schema = {
  /**
   * Creates a boolean schema
   */
  boolean: () => new BooleanSchema(),

  /**
   * Creates a string schema
   */
  string: () => new StringSchema(),

  /**
   * Creates a number schema
   */
  number: () => new NumberSchema(),

  /**
   * Creates an object schema with a defined shape
   * @param shape An object mapping keys to schemas
   */
  object: <TShape extends ObjectShape>(shape: TShape) =>
    new ObjectSchema(shape),

  /**
   * Creates an array schema with a defined element type
   * @param elementSchema The schema for array elements
   */
  array: <TElementSchema extends BaseSchema<unknown>>(
    elementSchema: TElementSchema,
  ) => new ArraySchema(elementSchema),
};
