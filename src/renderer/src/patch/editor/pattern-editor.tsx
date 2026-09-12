import { ModalFrameStructured } from "@renderer/components/floating/modal/ModalFrameStructured";
import { useModalStore } from "@renderer/components/floating/modal/modal-store";
import type { TextDesc } from "@shared/protocol/catalog";
import { useEffect, useState } from "react";
import { CodeEditor } from "./CodeEditor";
import { useSoundingRanges } from "./sounding";

/**
 * The editor a text property opens in: the value, room to work in, and the music underneath it.
 *
 * The inspector's own field is one line, which is enough to see what a pattern is and not enough to
 * write one. This is the same value with space around it, syntax colouring, completions for the
 * operators, and -- the reason it is worth being a modal rather than a bigger field -- the step
 * that is sounding lit up as it plays, so a pattern can be read against what you hear.
 *
 * The value is committed when the editor closes, not on every keystroke: node data is structural,
 * so each commit rebuilds the module. See the node data section of docs/engine.md.
 */

export interface PatternEditorProps {
  moduleId: string;
  text: TextDesc;
  value: string;
  onCommit: (value: string) => void;
  onClose: () => void;
}

const PatternEditor = ({
  moduleId,
  text,
  value,
  onCommit,
  onClose,
}: PatternEditorProps) => {
  const [draft, setDraft] = useState(value);
  const highlights = useSoundingRanges(moduleId, text.id);

  const apply = (): void => {
    onCommit(draft);
    onClose();
  };

  // Escape and the backdrop go through the modal's own dismissal, which keeps the draft: closing
  // without applying should leave the module exactly as it was.
  useEffect(() => setDraft(value), [value]);

  return (
    <ModalFrameStructured
      title={text.name}
      onClose={onClose}
      data-testid="pattern-editor"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded px-3 py-1 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            data-testid="pattern-editor-apply"
            className="cursor-pointer rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
          >
            Apply
          </button>
        </>
      }
    >
      <p className="mb-2 text-xs text-muted-foreground">{text.doc}</p>
      <div className="h-40 rounded border border-border">
        <CodeEditor
          value={draft}
          language={text.language}
          onChange={setDraft}
          onCommit={apply}
          highlights={highlights}
        />
      </div>
    </ModalFrameStructured>
  );
};

/** Opens the editor for one text property. Returns nothing: the modal store owns it from here. */
export function openPatternEditor(args: {
  moduleId: string;
  text: TextDesc;
  value: string;
  onCommit: (value: string) => void;
}): void {
  const { openModal, closeModal } = useModalStore.getState();
  const id = openModal({
    size: "2xl",
    content: (
      <PatternEditor
        moduleId={args.moduleId}
        text={args.text}
        value={args.value}
        onCommit={args.onCommit}
        onClose={() => closeModal(id)}
      />
    ),
  });
}
