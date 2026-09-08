import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";

/** Initial width of the label column in pixels. Matches the old hard-
 *  coded `w-32` (8rem = 128px) so behavior is unchanged out of the box. */
export const DEFAULT_LABEL_WIDTH = 128;
export const MIN_LABEL_WIDTH = 60;
export const MAX_LABEL_WIDTH = 400;

/** Clamp a candidate label width to `[MIN_LABEL_WIDTH, MAX_LABEL_WIDTH]`.
 *  Extracted as a pure function so it's trivially unit-testable
 *  without spinning up React. The splitter and the provider both
 *  funnel through this. */
export function clampLabelWidth(width: number): number {
  return Math.min(MAX_LABEL_WIDTH, Math.max(MIN_LABEL_WIDTH, width));
}

export interface SchemaFormLayoutContextValue {
  labelWidth: number;
  setLabelWidth: (width: number) => void;
}

const SchemaFormLayoutContext = createContext<SchemaFormLayoutContextValue>({
  labelWidth: DEFAULT_LABEL_WIDTH,
  setLabelWidth: () => {},
});

export interface SchemaFormLayoutProviderProps {
  children: ReactNode;
  /** Optional initial width override. Useful for tests. */
  initialWidth?: number;
}

/** Provides a `labelWidth` (in px) clamped to [MIN, MAX] for every
 *  field rendered under it. Ported from Nubase. In-memory only —
 *  width resets to default on reload (matches Nubase). */
export const SchemaFormLayoutProvider = ({
  children,
  initialWidth = DEFAULT_LABEL_WIDTH,
}: SchemaFormLayoutProviderProps) => {
  const [labelWidth, setLabelWidthRaw] = useState(initialWidth);

  const setLabelWidth = useCallback((width: number) => {
    setLabelWidthRaw(clampLabelWidth(width));
  }, []);

  return (
    <SchemaFormLayoutContext.Provider value={{ labelWidth, setLabelWidth }}>
      {children}
    </SchemaFormLayoutContext.Provider>
  );
};

export const useSchemaFormLayout = (): SchemaFormLayoutContextValue => {
  return useContext(SchemaFormLayoutContext);
};
