import { getConfigJsonSchema } from "@renderer/config/config-schema";
// The core API and the JSON language service, named separately.
//
// Importing the `monaco-editor` barrel instead registers every language Monaco ships -- abap,
// solidity, freemarker -- which was a 7.7 MB chunk and ninety tokenizer files for a window that only
// ever opens one JSON document. `features/json/register` declares the language itself, so nothing
// else is needed for colouring.
import * as monaco from "monaco-editor/editor/editor.api";
// Without the `esm/vs/` prefix: the package's `exports` map already adds it (`./*` resolves to
// `./esm/vs/*.js`), so the longer path used by older setups resolves to `esm/vs/esm/vs/...` and
// fails at bundle time.
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import { jsonDefaults } from "monaco-editor/languages/features/json/register";
import { registerMiniLanguage } from "./monaco-mini";
import { installMonacoTheme } from "./monaco-theme";

/**
 * Monaco, set up once, knowing the settings schema.
 *
 * Two workers, not five. The settings file is JSON and nothing else is edited here, so the
 * TypeScript, CSS and HTML language workers would be thirteen megabytes of dead weight in the
 * bundle — and the TypeScript one needs `eval`, which this renderer's content policy forbids.
 *
 * The editor itself runs fine under `script-src 'self'`; workers are allowed because the policy
 * permits `worker-src 'self' blob:`, which is what Vite's `?worker` imports produce.
 */
self.MonacoEnvironment = {
  // Trusted Types are not configured for this window, and returning a policy Monaco then uses to
  // create one fails. Declining leaves Monaco on its plain string path.
  createTrustedTypesPolicy(): undefined {
    return undefined;
  },
  getWorker(_id: string, label: string): Worker {
    return label === "json" ? new jsonWorker() : new editorWorker();
  },
};

/**
 * Teaches the editor what a setting is.
 *
 * This is what makes the settings file explorable: control-space offers the keys, hovering one
 * describes it, and a misspelling or an out-of-range number is underlined as you type rather than
 * reported after you save. The schema is generated from the same Zod definition that validates at
 * runtime, so the editor cannot disagree with the application about what is allowed.
 */
function configureJson(): void {
  jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    schemas: [
      {
        uri: "phasegrid://settings-schema.json",
        // Every model this editor opens is the settings, so one schema matches all of them.
        fileMatch: ["*"],
        schema: getConfigJsonSchema(),
      },
    ],
    // Provided inline above; there is no server to ask.
    enableSchemaRequest: false,
  });

  jsonDefaults.setModeConfiguration({
    documentFormattingEdits: true,
    documentRangeFormattingEdits: true,
    completionItems: true,
    hovers: true,
    documentSymbols: true,
    tokens: true,
    // Off, because the provider below replaces it: Monaco's own only recognises CSS colour
    // functions, and the canvas colours in this file are plain hex strings.
    colors: false,
    foldingRanges: true,
    diagnostics: true,
  });

  registerHexColourProvider();
  // Mini-notation, for the pattern editor. Registered alongside JSON rather than lazily, because
  // both go through this one setup and a second entry point is how the two configurations drift.
  registerMiniLanguage(monaco);
}

/**
 * A swatch beside every `#rrggbb`, and a colour picker on it.
 *
 * The grid's colours are hex because that is what the canvas can parse, and a hex string in JSON is
 * otherwise six characters you have to imagine. This is the one place the settings file stops being
 * text and becomes the thing it describes.
 */
let colourProviderRegistered = false;
function registerHexColourProvider(): void {
  if (colourProviderRegistered) return;
  colourProviderRegistered = true;

  const hex = /"(#[0-9a-fA-F]{6})"/g;

  monaco.languages.registerColorProvider("json", {
    provideDocumentColors(model) {
      const text = model.getValue();
      const colours: monaco.languages.IColorInformation[] = [];
      hex.lastIndex = 0;
      for (let match = hex.exec(text); match !== null; match = hex.exec(text)) {
        const value = match[1];
        // Inside the quotes, so replacing the range leaves the JSON string intact.
        const from = model.getPositionAt(match.index + 1);
        const to = model.getPositionAt(match.index + 1 + value.length);
        colours.push({
          range: {
            startLineNumber: from.lineNumber,
            startColumn: from.column,
            endLineNumber: to.lineNumber,
            endColumn: to.column,
          },
          color: {
            red: Number.parseInt(value.slice(1, 3), 16) / 255,
            green: Number.parseInt(value.slice(3, 5), 16) / 255,
            blue: Number.parseInt(value.slice(5, 7), 16) / 255,
            alpha: 1,
          },
        });
      }
      return colours;
    },

    provideColorPresentations(_model, info) {
      const channel = (n: number) =>
        Math.round(n * 255)
          .toString(16)
          .padStart(2, "0");
      const { red, green, blue } = info.color;
      // Hex only. The canvas reads these with `hexToNumber`, which parses nothing else, so offering
      // `rgb()` would let the picker write a colour the grid renders as black.
      return [{ label: `#${channel(red)}${channel(green)}${channel(blue)}` }];
    },
  });
}

let configured = false;

/**
 * Monaco, configured. Does its setup once, however many editors ask.
 *
 * Still a promise, because the caller creates an editor after an await and the guard against
 * unmounting in that gap is worth keeping even though the work is now synchronous -- and because
 * `monaco.editor.create` cannot be called before `configureJson` has run or the first editor opens
 * without a schema.
 */
export function initializeMonaco(): Promise<typeof monaco> {
  if (!configured) {
    configureJson();
    // The editor in the application's own colours, re-derived when the theme changes.
    installMonacoTheme(monaco);
    configured = true;
  }
  return Promise.resolve(monaco);
}
