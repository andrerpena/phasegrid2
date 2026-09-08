import type { AnyFieldApi } from "@tanstack/react-form";
import type React from "react";
import type { BaseSchema, SchemaMetadata } from "../../../schemas/core/schema";

/**
 * Lifecycle callbacks for edit field components.
 */
export interface EditFieldLifecycle {
  /** Called when edit mode starts */
  onEnterEdit?: () => void;
  /** Called when edit mode ends */
  onExitEdit?: () => void;
  /**
   * Called by auto-commit renderers when a value should be committed.
   * @param value - Optional value to commit directly
   */
  onValueCommit?: (value?: unknown) => void;
}

/**
 * Props for edit field renderers.
 */
export interface EditFieldRendererProps {
  schema: BaseSchema<unknown>;
  fieldState: AnyFieldApi;
  hasError: boolean;
  metadata: SchemaMetadata<unknown>;
  /** Whether this field should be auto-focused on mount */
  autoFocus?: boolean;
}

/**
 * Result from edit field renderers.
 */
export interface EditFieldRendererResult {
  element: React.ReactElement<{ id?: string; hasError?: boolean }>;
  lifecycle?: EditFieldLifecycle;
  /**
   * When true, the field will auto-commit on value change without requiring
   * the user to click the check button. Suitable for Toggle and Select fields.
   */
  autoCommit?: boolean;
}

/**
 * Edit field renderer function type.
 */
export type EditFieldRenderer = (
  props: EditFieldRendererProps,
) => EditFieldRendererResult;

/**
 * Map of schema type to edit field renderer.
 */
export type EditFieldRendererMap = Record<string, EditFieldRenderer>;
