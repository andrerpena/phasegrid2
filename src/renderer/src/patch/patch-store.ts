import { useHistoryStore } from "@renderer/history/history-store";
import {
  EMPTY_PATCH,
  type PatchDoc,
  type PatchOp,
} from "@shared/protocol/patch";
import { create } from "zustand";
import { applyOps, invert } from "./ops";

/**
 * The patch document, and the only way to change it.
 *
 * Every edit is a list of operations, which is what lets one gesture become one undo entry, one batch
 * to the engine and one line in a saved file. The frontend owns this document; the engine mirrors it.
 * That direction matters: a document owned by the audio process could not be edited while the audio
 * process was busy, and could not be edited at all while it was restarting.
 */

export type OpsListener = (ops: readonly PatchOp[], source: EditSource) => void;

/** Where an edit came from. `remote` is the engine telling us something we did not do. */
export type EditSource = "user" | "remote" | "load";

interface ApplyOptions {
  /** A sentence for the history widget. Omitting it means the edit is not undoable. */
  label?: string;
  source?: EditSource;
  /**
   * How to undo this edit, when deriving it from the document would be wrong.
   *
   * Needed by a gesture that showed its result live and is only now being recorded: a knob drag has
   * already written the document sixty times, so the document no longer remembers where the knob was
   * when the hand went down. The caller does, and passes it here. Everything else leaves this alone
   * and gets the inverse derived from the document, which cannot drift from what the edit did.
   */
  inverse?: PatchOp[];
}

interface PatchState {
  doc: PatchDoc;
  /** Bumped on every change, so a renderer can tell "something moved" without diffing. */
  version: number;
}

interface PatchActions {
  apply: (ops: PatchOp[], options?: ApplyOptions) => void;
  replace: (doc: PatchDoc) => void;
  subscribeOps: (listener: OpsListener) => () => void;
}

const listeners = new Set<OpsListener>();

export const usePatchStore = create<PatchState & PatchActions>((set, get) => ({
  doc: EMPTY_PATCH,
  version: 0,

  apply: (ops, options = {}) => {
    if (ops.length === 0) return;
    const before = get().doc;
    const after = applyOps(before, ops);
    set({ doc: after, version: get().version + 1 });

    // History is recorded from the same operations that were applied, and its inverse is derived from
    // the document they were applied to. Undo therefore cannot drift from what the edit actually did,
    // which it would if the two were written separately. The exception is a caller that hands over an
    // inverse of its own, because the document has already moved under it; see `ApplyOptions`.
    if (options.label !== undefined) {
      const inverse = options.inverse ?? invert(before, ops);
      useHistoryStore.getState().push({
        label: options.label,
        apply: () => get().apply(ops, { source: "user" }),
        revert: () => get().apply(inverse, { source: "user" }),
      });
    }

    for (const listener of [...listeners])
      listener(ops, options.source ?? "user");
  },

  /**
   * Replaces the whole document, for opening a project.
   *
   * Not undoable and not announced as operations: nobody wants to step back through a file being
   * opened one module at a time, and the engine is told with a single load rather than a batch of
   * hundreds.
   */
  replace: (doc) => {
    useHistoryStore.getState().clear();
    set({ doc, version: get().version + 1 });
    for (const listener of [...listeners]) listener([], "load");
  },

  subscribeOps: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
}));
