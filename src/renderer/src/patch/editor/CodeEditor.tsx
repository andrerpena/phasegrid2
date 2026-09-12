import { initializeMonaco } from "@renderer/components/monaco-editor";
import { monacoLanguageFor } from "@renderer/components/monaco-mini";
import { THEME_ID } from "@renderer/components/monaco-theme";
import type * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";

export interface CodeEditorProps {
  value: string;
  language: string | undefined;
  onChange: (value: string) => void;
  /** Cmd/Ctrl+Enter: the gesture that says "done", without reaching for the mouse. */
  onCommit?: () => void;
  /** Character ranges to outline: the steps that are sounding right now. */
  highlights?: readonly { from: number; to: number }[];
  /**
   * `line` is the pattern field: one line, no gutter, no wrapping, because the highlight must not move
   * under the steps. `document` is a file: line numbers, folding, wrapping.
   */
  variant?: "line" | "document";
  /**
   * A URI for the editor's model. A JSON schema in `monaco-editor.ts` is bound to a URI pattern, so a
   * document that wants one names itself; without this the model is anonymous and no schema applies.
   */
  modelUri?: string;
}

/**
 * A one-string code editor, on Monaco.
 *
 * The same division `ConfigEditor` uses, for the same reasons: Monaco owns its DOM and its model,
 * React owns the element's lifetime, and everything the effect needs from props is read through a
 * ref so a changing callback never tears the editor down mid-keystroke.
 *
 * What is different is the decorations. The engine says which characters are sounding, and they are
 * marked here as the music moves -- the idea borrowed from Strudel's own editor, which marks active
 * events by source location rather than by re-parsing what you typed.
 */
export const CodeEditor = ({
  value,
  language,
  onChange,
  onCommit,
  highlights,
  variant = "line",
  modelUri,
}: CodeEditorProps) => {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const collection = useRef<monaco.editor.IEditorDecorationsCollection | null>(
    null,
  );
  /** Set while we are the ones writing, so an external update is not reported back as an edit. */
  const applying = useRef(false);
  const latest = useRef(value);
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const languageRef = useRef(language);

  onChangeRef.current = onChange;
  onCommitRef.current = onCommit;
  latest.current = value;
  languageRef.current = language;

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    let disposed = false;

    void initializeMonaco().then((instance) => {
      if (disposed || host.current === null || editor.current !== null) return;

      const languageId = monacoLanguageFor(languageRef.current);
      let ownModel: monaco.editor.ITextModel | null = null;
      if (modelUri !== undefined) {
        const uri = instance.Uri.parse(modelUri);
        ownModel =
          instance.editor.getModel(uri) ??
          instance.editor.createModel(latest.current, languageId, uri);
        if (ownModel.getValue() !== latest.current)
          ownModel.setValue(latest.current);
      }
      const document = variant === "document";
      const created = instance.editor.create(element, {
        ...(ownModel
          ? { model: ownModel }
          : { value: latest.current, language: languageId }),
        theme: THEME_ID,
        automaticLayout: true,
        scrollBeyondLastLine: false,
        minimap: { enabled: false },
        fontSize: document ? 13 : 14,
        fontFamily: '"Source Code Pro", ui-monospace, Menlo, monospace',
        tabSize: 2,
        // A pattern is read as one line of steps; wrapping it would move the steps around under
        // the highlight as you type, which is exactly what a live editor must not do. A document
        // is read as a file, and gets a file's gutter.
        wordWrap: document ? "on" : "off",
        lineNumbers: document ? "on" : "off",
        folding: document,
        glyphMargin: false,
        lineDecorationsWidth: document ? undefined : 0,
        lineNumbersMinChars: document ? undefined : 0,
        renderLineHighlight: document ? "line" : "none",
        overviewRulerLanes: 0,
        scrollbar: { vertical: "auto", horizontal: "auto" },
        fixedOverflowWidgets: true,
      });
      editor.current = created;
      collection.current = created.createDecorationsCollection([]);
      created.focus();

      created.onDidChangeModelContent(() => {
        if (applying.current) return;
        onChangeRef.current(created.getValue());
      });

      created.addAction({
        id: "phasegrid.commitPattern",
        label: "Apply",
        keybindings: [instance.KeyMod.CtrlCmd | instance.KeyCode.Enter],
        run: () => onCommitRef.current?.(),
      });
    });

    return () => {
      disposed = true;
      collection.current?.clear();
      collection.current = null;
      const model =
        modelUri !== undefined ? (editor.current?.getModel() ?? null) : null;
      editor.current?.dispose();
      model?.dispose();
      editor.current = null;
    };
  }, [modelUri, variant]);

  // Follows the document when the change came from somewhere else -- an undo, or the canvas.
  useEffect(() => {
    const created = editor.current;
    if (created === null || created.getValue() === value) return;
    applying.current = true;
    created.setValue(value);
    applying.current = false;
  }, [value]);

  useEffect(() => {
    const created = editor.current;
    const marks = collection.current;
    if (created === null || marks === null) return;
    const model = created.getModel();
    if (model === null) return;
    marks.set(
      (highlights ?? []).map(({ from, to }) => {
        const start = model.getPositionAt(from);
        const end = model.getPositionAt(to);
        return {
          range: {
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          },
          options: { inlineClassName: "pg-step-sounding" },
        };
      }),
    );
  }, [highlights]);

  return <div ref={host} className="h-full w-full overflow-hidden" />;
};
