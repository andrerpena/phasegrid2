import {
  initializeMonaco,
  SETTINGS_MODEL_URI,
} from "@renderer/components/monaco-editor";
import { THEME_ID } from "@renderer/components/monaco-theme";
import type * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";

export interface ConfigEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
}

/**
 * A JSON editor over one string.
 *
 * Monaco owns its own DOM and its own model, so React's job here is the element's lifetime and
 * nothing else — the same division the Pixi canvas uses. Everything the effect below needs from
 * props is read through a ref, so a changing callback never tears the editor down and rebuilds it,
 * which would lose the cursor on every keystroke.
 */
export const ConfigEditor = ({
  value,
  onChange,
  onSave,
  readOnly = false,
}: ConfigEditorProps) => {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  /** Set while we are the ones writing, so an external update is not reported back as an edit. */
  const applying = useRef(false);
  const latest = useRef(value);
  const initialReadOnly = useRef(readOnly);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  latest.current = value;

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    let disposed = false;

    void initializeMonaco().then((instance) => {
      // Monaco loads asynchronously; React can unmount, or a second effect can run, in the gap.
      if (disposed || host.current === null || editor.current !== null) return;

      // A model with the settings URI, so the settings schema -- and only that one -- applies to it.
      const uri = instance.Uri.parse(SETTINGS_MODEL_URI);
      const model =
        instance.editor.getModel(uri) ??
        instance.editor.createModel(latest.current, "json", uri);
      // The value may have moved on while Monaco was loading.
      if (model.getValue() !== latest.current) model.setValue(latest.current);
      const created = instance.editor.create(element, {
        model,
        // The application's own palette -- see `monaco-theme.ts`. It re-derives itself when the
        // theme changes, so nothing here has to follow it.
        theme: THEME_ID,
        readOnly: initialReadOnly.current,
        automaticLayout: true,
        scrollBeyondLastLine: false,
        // No minimap in a settings file: it is fifty lines and the strip is pure decoration.
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: '"Source Code Pro", ui-monospace, Menlo, monospace',
        tabSize: 2,
        formatOnPaste: true,
        lineNumbers: "on",
        folding: true,
        wordWrap: "on",
        // Lets a completion popup or a hover extend past the panel's edge, which in a docked
        // sidebar is most of them.
        fixedOverflowWidgets: true,
      });
      editor.current = created;

      created.onDidChangeModelContent(() => {
        if (applying.current) return;
        onChangeRef.current?.(created.getValue());
      });

      created.addAction({
        id: "phasegrid.saveSettings",
        label: "Save settings",
        keybindings: [instance.KeyMod.CtrlCmd | instance.KeyCode.KeyS],
        run: () => onSaveRef.current?.(),
      });
    });

    return () => {
      disposed = true;
      const model = editor.current?.getModel() ?? null;
      editor.current?.dispose();
      model?.dispose();
      editor.current = null;
    };
  }, []);

  // Follows the store when the change came from somewhere else — a Reset, or another panel.
  useEffect(() => {
    const created = editor.current;
    if (created === null || created.getValue() === value) return;
    applying.current = true;
    created.setValue(value);
    applying.current = false;
  }, [value]);

  useEffect(() => {
    editor.current?.updateOptions({ readOnly });
  }, [readOnly]);

  return <div ref={host} className="h-full w-full overflow-hidden" />;
};
