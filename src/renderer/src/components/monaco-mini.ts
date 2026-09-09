import type * as monaco from "monaco-editor/editor/editor.api";

/**
 * Tidal/Strudel mini-notation, taught to Monaco.
 *
 * Colouring only: what a pattern MEANS is the engine's business, and the engine is the only thing
 * that parses it (see `engine/src/pattern/`). What this does is separate the two halves a person
 * reading a pattern has to separate anyway -- the values, which are notes and numbers, from the
 * grammar that arranges them in time -- so that `<c4 eb4> g3*2 [~ bb3]` reads as structure rather
 * than as punctuation.
 *
 * A pattern the engine rejects is not underlined here. It could be, but the engine is the authority
 * and duplicating its grammar in a tokenizer is how the two come to disagree; the module says so
 * instead, by playing nothing.
 */

export const MINI_LANGUAGE_ID = "phasegrid-mini";

/** A bare note name, Strudel's spelling: a letter, any run of accidentals, an optional octave. */
const NOTE = /[a-gA-G](?:[#bsf]*)(?:-?\d+)?(?![\w#])/;

const TOKENIZER: monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenizer: {
    root: [
      // A rest, first: `~` and a bare `-` are silence, and nothing else here should claim them.
      [/~/, "comment"],
      [/(?<![\w.])-(?![\w.])/, "comment"],
      [NOTE, "type"],
      [/\d+(?:\.\d+)?|\.\d+/, "number"],
      // The operators that arrange steps in time. Kept as one class: they are one idea, and
      // colouring `*` differently from `!` would suggest a distinction the notation does not make.
      [/[*/!@?]/, "keyword"],
      [/\.\./, "keyword"],
      [/[[\]<>{}()]/, "delimiter.bracket"],
      [/[,|:%_]/, "delimiter"],
    ],
  },
};

/** The words worth completing: the operators, with what each one does. */
const COMPLETIONS: { label: string; insert: string; doc: string }[] = [
  { label: "~", insert: "~", doc: "A rest: a step nothing sounds in" },
  {
    label: "[ ]",
    insert: "[$0]",
    doc: "Subdivide a step into a sequence of its own",
  },
  { label: "< >", insert: "<$0>", doc: "Take one of these per cycle, in turn" },
  {
    label: "{ }",
    insert: "{$0}",
    doc: "A polymeter: parts of different lengths against one pulse",
  },
  { label: "*", insert: "*$0", doc: "Play this many times as fast" },
  { label: "/", insert: "/$0", doc: "Play this many times as slow" },
  { label: "!", insert: "!$0", doc: "Repeat this step, as separate notes" },
  {
    label: "@",
    insert: "@$0",
    doc: "Give this step that many times the width",
  },
  { label: "?", insert: "?", doc: "Drop this step at random, half the time" },
  {
    label: "( )",
    insert: "($1,$2)",
    doc: "A euclidean rhythm: pulses spread over steps",
  },
  { label: ",", insert: ",", doc: "Stack: play these at the same time" },
  { label: "|", insert: "|", doc: "Choose one of these at random, per cycle" },
];

let registered = false;

/**
 * Registers the language, once, however many editors ask.
 *
 * Takes the Monaco instance rather than importing it, so this file stays free of the module-level
 * side effects `monaco-editor.ts` owns -- there is one place that sets Monaco up, and this adds to
 * it rather than becoming a second one.
 */
export function registerMiniLanguage(instance: typeof monaco): void {
  if (registered) return;
  registered = true;

  instance.languages.register({ id: MINI_LANGUAGE_ID });
  instance.languages.setMonarchTokensProvider(MINI_LANGUAGE_ID, TOKENIZER);
  instance.languages.setLanguageConfiguration(MINI_LANGUAGE_ID, {
    brackets: [
      ["[", "]"],
      ["<", ">"],
      ["{", "}"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "[", close: "]" },
      { open: "<", close: ">" },
      { open: "{", close: "}" },
      { open: "(", close: ")" },
    ],
    surroundingPairs: [
      { open: "[", close: "]" },
      { open: "<", close: ">" },
      { open: "{", close: "}" },
      { open: "(", close: ")" },
    ],
  });

  instance.languages.registerCompletionItemProvider(MINI_LANGUAGE_ID, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: COMPLETIONS.map((item) => ({
          label: item.label,
          kind: instance.languages.CompletionItemKind.Operator,
          insertText: item.insert,
          insertTextRules:
            instance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: item.doc,
          range,
        })),
      };
    },
  });
}

/** The Monaco language for a descriptor's `language`, or plain text for one we do not know. */
export function monacoLanguageFor(language: string | undefined): string {
  return language === "mini" ? MINI_LANGUAGE_ID : "plaintext";
}
