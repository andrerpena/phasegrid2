import type { ConfigRecord, ConfigValue } from "@shared/protocol/storage";
import { create } from "zustand";

/**
 * Configuration: built-in defaults, the user's overrides on top, and the merged result everything reads.
 *
 * Overrides are edited as text, because the settings widget is a JSON editor and a person mid-edit has
 * text that does not parse yet. Keeping the raw text beside the last valid object is what lets the
 * editor show what was typed while the application keeps running on the last thing that made sense.
 * Text that does not parse is never written, so what is on disk is always something that loads.
 *
 * The overrides are the `settings` object in the workspace's `workspace.json`. They belong to the
 * workspace rather than to the installation because a workspace is a thing you copy to another machine,
 * and settings you tuned for the music you are making should arrive with it.
 */

export interface ConfigState {
  defaults: ConfigRecord;
  overrides: ConfigRecord;
  /** defaults with overrides applied. What `get` reads. */
  computed: ConfigRecord;
  /** What the editor shows. May not parse. */
  overridesText: string;
  parseError: string | null;
  loaded: boolean;
}

export interface ConfigActions {
  get(key: string): ConfigValue;
  getNumber(key: string, fallback: number): number;
  getString(key: string, fallback: string): string;
  getBoolean(key: string, fallback: boolean): boolean;
  set(key: string, value: ConfigValue): void;
  remove(key: string): void;
  /** Parses; on success the overrides move, on failure only the text and the error do. */
  setOverridesText(text: string): void;
  reset(): void;
  load(): Promise<void>;
  save(): Promise<void>;
}

export const DEFAULT_CONFIG: ConfigRecord = {
  "ui.theme": "dark",
  "grid.snap": 8,
  "grid.showParamPorts": "hover",
  "engine.blockSize": 64,
  "engine.voiceCount": 4,
  "telemetry.fps": 30,
  /**
   * Keybindings are a setting like any other, so they are one key here rather than a file of their own.
   *
   * Empty by default: what ships is `DEFAULT_KEYBINDINGS`, and what is written here is added after it,
   * so a user's file says what they changed rather than restating everything they did not. The key is
   * listed all the same, so the settings editor shows it exists.
   */
  keybindings: [],
};

function merge(defaults: ConfigRecord, overrides: ConfigRecord): ConfigRecord {
  return { ...defaults, ...overrides };
}

export const useConfigStore = create<ConfigState & ConfigActions>(
  (set, get) => ({
    defaults: DEFAULT_CONFIG,
    overrides: {},
    computed: DEFAULT_CONFIG,
    overridesText: "{}",
    parseError: null,
    loaded: false,

    get: (key) => get().computed[key] ?? null,
    // Typed readers rather than casts at every call site: a config file is user-editable, so a value
    // being the wrong type is an ordinary event and each reader decides what to do about it once.
    getNumber: (key, fallback) => {
      const v = get().computed[key];
      return typeof v === "number" && Number.isFinite(v) ? v : fallback;
    },
    getString: (key, fallback) => {
      const v = get().computed[key];
      return typeof v === "string" ? v : fallback;
    },
    getBoolean: (key, fallback) => {
      const v = get().computed[key];
      return typeof v === "boolean" ? v : fallback;
    },

    set: (key, value) => {
      const overrides = { ...get().overrides, [key]: value };
      set({
        overrides,
        computed: merge(get().defaults, overrides),
        overridesText: JSON.stringify(overrides, null, 2),
        parseError: null,
      });
      void get().save();
    },

    remove: (key) => {
      const overrides = { ...get().overrides };
      delete overrides[key];
      set({
        overrides,
        computed: merge(get().defaults, overrides),
        overridesText: JSON.stringify(overrides, null, 2),
        parseError: null,
      });
      void get().save();
    },

    setOverridesText: (text) => {
      let parsed: ConfigRecord | null = null;
      let parseError: string | null = null;
      try {
        const value: unknown = JSON.parse(text);
        if (value === null || typeof value !== "object" || Array.isArray(value))
          parseError = "configuration must be an object";
        else parsed = value as ConfigRecord;
      } catch (error) {
        parseError = (error as Error).message;
      }
      // On a parse failure the text and the error change and nothing else does: the application keeps
      // running on the last configuration that made sense, which is what lets someone edit freely.
      if (parsed === null) {
        set({ overridesText: text, parseError });
        return;
      }
      set({
        overridesText: text,
        parseError: null,
        overrides: parsed,
        computed: merge(get().defaults, parsed),
      });
      void get().save();
    },

    reset: () => {
      set({
        overrides: {},
        computed: get().defaults,
        overridesText: "{}",
        parseError: null,
      });
      void get().save();
    },

    /**
     * Reads the workspace's settings.
     *
     * Called again every time a workspace opens, not once at startup: settings belong to the folder, so
     * switching folders has to switch them. A failure — most often "no workspace is open", before one
     * has been picked — leaves the defaults in place, which is what the gate is showing anyway.
     */
    load: async () => {
      const result = await window.workspace.readSettings();
      if (!result.ok || result.value === null) {
        set({
          overrides: {},
          computed: get().defaults,
          overridesText: "{}",
          parseError: null,
          loaded: true,
        });
        return;
      }
      get().setOverridesText(result.value);
      set({ loaded: true });
    },

    save: async () => {
      // The text, not the parsed object, so reopening shows what was typed — the spacing someone chose,
      // and the "unused key I might want back" they left at the bottom.
      await window.workspace.writeSettings(get().overridesText);
    },
  }),
);
