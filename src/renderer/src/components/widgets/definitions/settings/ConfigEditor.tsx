import { initializeMonaco } from "@renderer/components/monaco-editor";
import { useThemeStore } from "@renderer/theming/theme-store";
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

      const created = instance.editor.create(element, {
        // The value may have moved on while Monaco was loading.
        value: latest.current,
        language: "json",
        // Monaco's own themes, not the application's: it ships two, and picking by lightness is the
        // closest thing to following the theme without hand-writing a token map for the editor.
        theme:
          useThemeStore.getState().theme.type === "light" ? "vs" : "vs-dark",
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
      editor.current?.dispose();
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

  // Follows the theme, so switching to Light does not leave a dark rectangle in the window.
  useEffect(() =>
    useThemeStore.subscribe((state) => {
      editor.current?.updateOptions({
        theme: state.theme.type === "light" ? "vs" : "vs-dark",
      });
    }),
  );

  return <div ref={host} className="h-full w-full overflow-hidden" />;
};
