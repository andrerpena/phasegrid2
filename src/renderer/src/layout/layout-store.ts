import { create } from "zustand";

/**
 * Where the panels are and how big they are.
 *
 * Sizes are ratios of the window rather than pixels, so a layout saved on a large display still makes
 * sense on a small one. The shell this copies stored pixels and mirrored the whole layout into the
 * config file, comparing them by serialising both to JSON on every change; here the layout is its own
 * stored key and the comparison is per field.
 */

export interface LayoutState {
  /** Fraction of the window width taken by the left column. */
  leftWidth: number;
  rightWidth: number;
  /** Fraction of the centre column's height taken by the panel under it. */
  centerBottomHeight: number;
  /** Fraction of each side column taken by its upper panel. */
  leftSplit: number;
  rightSplit: number;
  leftVisible: boolean;
  rightVisible: boolean;
  centerBottomVisible: boolean;
  loaded: boolean;
}

export interface LayoutActions {
  setSize: (key: SizeKey, value: number) => void;
  toggle: (key: VisibilityKey) => void;
  reset: () => void;
  load: () => Promise<void>;
  save: () => Promise<void>;
}

export type SizeKey =
  | "leftWidth"
  | "rightWidth"
  | "centerBottomHeight"
  | "leftSplit"
  | "rightSplit";
export type VisibilityKey =
  | "leftVisible"
  | "rightVisible"
  | "centerBottomVisible";

export const DEFAULT_LAYOUT: Omit<LayoutState, "loaded"> = {
  leftWidth: 0.18,
  rightWidth: 0.22,
  centerBottomHeight: 0.28,
  leftSplit: 0.5,
  rightSplit: 0.55,
  leftVisible: true,
  rightVisible: true,
  centerBottomVisible: true,
};

/** Panels stay usable: a drag can never collapse one to nothing or push another off the window. */
const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return MIN_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

export const useLayoutStore = create<LayoutState & LayoutActions>(
  (set, get) => ({
    ...DEFAULT_LAYOUT,
    loaded: false,

    setSize: (key, value) => {
      set({ [key]: clampRatio(value) } as Partial<LayoutState>);
      void get().save();
    },

    toggle: (key) => {
      set({ [key]: !get()[key] } as Partial<LayoutState>);
      void get().save();
    },

    reset: () => {
      set({ ...DEFAULT_LAYOUT });
      void get().save();
    },

    load: async () => {
      const result = await window.appStorage.read("layout");
      if (!result.ok || result.value === null) {
        set({ loaded: true });
        return;
      }
      try {
        const stored: unknown = JSON.parse(result.value);
        if (stored === null || typeof stored !== "object") {
          set({ loaded: true });
          return;
        }
        // Field by field, clamped, ignoring anything unrecognised. A layout file from an older or newer
        // build should restore what it can rather than being discarded whole or trusted whole.
        const record = stored as Record<string, unknown>;
        const next: Partial<LayoutState> = {};
        for (const key of [
          "leftWidth",
          "rightWidth",
          "centerBottomHeight",
          "leftSplit",
          "rightSplit",
        ] as const) {
          const v = record[key];
          if (typeof v === "number") next[key] = clampRatio(v);
        }
        for (const key of [
          "leftVisible",
          "rightVisible",
          "centerBottomVisible",
        ] as const) {
          const v = record[key];
          if (typeof v === "boolean") next[key] = v;
        }
        set({ ...next, loaded: true });
      } catch {
        // A corrupt layout costs the default layout, nothing more.
        set({ loaded: true });
      }
    },

    save: async () => {
      const {
        loaded: _loaded,
        setSize: _s,
        toggle: _t,
        reset: _r,
        load: _l,
        save: _sv,
        ...rest
      } = get();
      await window.appStorage.write("layout", JSON.stringify(rest, null, 2));
    },
  }),
);
