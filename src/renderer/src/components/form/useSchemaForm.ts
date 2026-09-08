import { type ReactFormExtendedApi, useForm } from "@tanstack/react-form";
import { useMemo, useState } from "react";
import type {
  BaseSchema,
  Infer,
  ObjectSchema,
  ObjectShape,
} from "../../schemas/core/schema";

export interface SchemaFormConfiguration<
  TSchema extends ObjectSchema<ObjectShape> = ObjectSchema<ObjectShape>,
  TData = Infer<TSchema>,
> {
  api: ReactFormExtendedApi<
    TData,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >;
  schema: TSchema;
  formState: Record<string, unknown>;
}

export interface UseSchemaFormOptions<
  TSchema extends ObjectSchema<ObjectShape>,
  TData extends Infer<TSchema> = Infer<TSchema>,
> {
  schema: TSchema;
  onSubmit: (data: TData) => void | Promise<void>;
  /** Initial values for the form fields */
  initialValues?: Partial<TData>;
}

/**
 * Creates a TanStack Form configured from a schema.
 * Derives default values from schema metadata.
 */
export function useSchemaForm<
  TSchema extends ObjectSchema<ObjectShape>,
  TData extends Infer<TSchema> = Infer<TSchema>,
>(
  options: UseSchemaFormOptions<TSchema, TData>,
): SchemaFormConfiguration<TSchema, TData> {
  const { schema, onSubmit, initialValues } = options;

  // Create default values from schema
  const defaultValues = useMemo(() => {
    const shape = schema.getShape();
    const defaults: Record<string, unknown> = {};

    for (const key of Object.keys(shape)) {
      const fieldSchema = shape[key] as BaseSchema<unknown>;
      // Use initial value if provided, otherwise use schema default
      defaults[key] =
        initialValues?.[key as keyof TData] ?? fieldSchema.defaultValue;
    }

    return defaults as TData;
  }, [schema, initialValues]);

  // Track form state for any computed metadata
  const [formState, setFormState] = useState<Record<string, unknown>>(
    defaultValues as Record<string, unknown>,
  );

  const form = useForm({
    defaultValues,
    listeners: {
      onChange: (formStateEvent) => {
        setFormState(
          formStateEvent.formApi.state.values as Record<string, unknown>,
        );
      },
      onChangeDebounceMs: 200,
    },
    onSubmit: async ({ value }) => {
      // Validate with Zod schema
      const result = schema.toZod().safeParse(value);
      if (!result.success) {
        console.error("Form validation failed:", result.error);
        throw new Error("Validation failed");
      }
      await onSubmit(result.data as TData);
    },
  });

  return useMemo(
    (): SchemaFormConfiguration<TSchema, TData> => ({
      api: form,
      schema,
      formState,
    }),
    [form, schema, formState],
  );
}
