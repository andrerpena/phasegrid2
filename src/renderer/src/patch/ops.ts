import type { PatchDoc, PatchModule, PatchOp } from "@shared/protocol/patch";

/**
 * Applying operations to a patch, and working out how to undo them.
 *
 * Pure functions over a document. The store, the history and the tests all use these, so "what does
 * this edit do" has exactly one answer, and undo is derived from the same description that was sent to
 * the engine rather than written separately and hoped to match.
 */

/**
 * Modules and edges are kept sorted by id.
 *
 * Order carries no meaning here: the compiler sorts the graph topologically and a patch file's array
 * order says nothing about what it sounds like. Making it canonical buys two things. Undo restores the
 * document exactly rather than approximately, because a removed module put back lands where it was
 * rather than at the end. And a saved patch diffs by what changed rather than by the order someone
 * happened to build it in, which is what makes a patch file reviewable.
 */
function canonical(doc: PatchDoc): PatchDoc {
  return {
    ...doc,
    modules: [...doc.modules].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...doc.edges].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function withoutModule(doc: PatchDoc, id: string): PatchDoc {
  return {
    ...doc,
    modules: doc.modules.filter((m) => m.id !== id),
    // Removing a module removes the edges that reach it. Leaving them would produce a document that
    // cannot be compiled, and the engine would reject the whole batch rather than the one bad edge.
    edges: doc.edges.filter((e) => e.from.module !== id && e.to.module !== id),
  };
}

export function applyOp(doc: PatchDoc, op: PatchOp): PatchDoc {
  return canonical(applyOpUnordered(doc, op));
}

function applyOpUnordered(doc: PatchDoc, op: PatchOp): PatchDoc {
  switch (op.op) {
    case "moduleAdd": {
      const module: PatchModule = {
        id: op.id,
        type: op.type,
        ...(op.params !== undefined ? { params: op.params } : {}),
        ...(op.data !== undefined ? { data: op.data } : {}),
        ...(op.x !== undefined ? { x: op.x } : {}),
        ...(op.y !== undefined ? { y: op.y } : {}),
        ...(op.label !== undefined ? { label: op.label } : {}),
      };
      return {
        ...doc,
        modules: [...doc.modules.filter((m) => m.id !== op.id), module],
      };
    }
    case "moduleRemove":
      return withoutModule(doc, op.id);
    case "moduleSetData":
      return {
        ...doc,
        modules: doc.modules.map((m) =>
          m.id === op.id ? { ...m, data: op.data } : m,
        ),
      };
    case "edgeAdd":
      return {
        ...doc,
        edges: [
          ...doc.edges.filter((e) => e.id !== op.id),
          { id: op.id, from: op.from, to: op.to },
        ],
      };
    case "edgeRemove":
      return { ...doc, edges: doc.edges.filter((e) => e.id !== op.id) };
    case "paramSet":
      return {
        ...doc,
        modules: doc.modules.map((m) =>
          m.id === op.module
            ? { ...m, params: { ...m.params, [op.param]: op.value } }
            : m,
        ),
      };
    case "moduleMove":
      return {
        ...doc,
        modules: doc.modules.map((m) =>
          m.id === op.id ? { ...m, x: op.x, y: op.y } : m,
        ),
      };
  }
}

export function applyOps(doc: PatchDoc, ops: readonly PatchOp[]): PatchDoc {
  return ops.reduce(applyOp, doc);
}

/**
 * The operations that undo `ops`, given the document they were applied to.
 *
 * Reversed, because undoing a sequence means undoing its last step first. Each inverse is computed
 * against the document as it stood at that step, which is why this walks forward building the inverses
 * and then reverses them: computing them all against the starting document would be wrong the moment
 * two operations touch the same thing.
 */
export function invert(doc: PatchDoc, ops: readonly PatchOp[]): PatchOp[] {
  const groups: PatchOp[][] = [];
  let current = doc;
  for (const op of ops) {
    groups.push(inverseOf(current, op));
    current = applyOp(current, op);
  }
  // The operations are undone last first, but each operation's own inverse is a sequence that has
  // to stay in its order: a removed module comes back before the cables plugged into it, or the
  // engine is asked for an edge to a node it does not have. Reversing the flat list did exactly
  // that whenever two removals were undone together.
  return groups.reverse().flat();
}

/** One operation's inverse. Several, where undoing needs more steps than doing did. */
function inverseOf(doc: PatchDoc, op: PatchOp): PatchOp[] {
  switch (op.op) {
    case "moduleAdd": {
      const existing = doc.modules.find((m) => m.id === op.id);
      // Adding over an existing id is a replacement, so its inverse is to put the old one back rather
      // than to remove it.
      if (existing === undefined) return [{ op: "moduleRemove", id: op.id }];
      return [{ op: "moduleAdd", ...existing }];
    }
    case "moduleRemove": {
      const existing = doc.modules.find((m) => m.id === op.id);
      if (existing === undefined) return [];
      // The edges go too, so undoing has to restore them. This is the case where one operation's
      // inverse is several, and the reason `inverseOf` returns a list.
      const edges = doc.edges.filter(
        (e) => e.from.module === op.id || e.to.module === op.id,
      );
      return [
        { op: "moduleAdd", ...existing },
        ...edges.map(
          (e): PatchOp => ({ op: "edgeAdd", id: e.id, from: e.from, to: e.to }),
        ),
      ];
    }
    case "moduleSetData": {
      const module = doc.modules.find((m) => m.id === op.id);
      if (module === undefined) return [];
      // The whole previous blob, including the case where there was none: a module that had no
      // data undoes back to having none, not to an empty object the engine would still rebuild for.
      return [{ op: "moduleSetData", id: op.id, data: module.data ?? {} }];
    }
    case "edgeAdd": {
      const existing = doc.edges.find((e) => e.id === op.id);
      if (existing === undefined) return [{ op: "edgeRemove", id: op.id }];
      return [
        {
          op: "edgeAdd",
          id: existing.id,
          from: existing.from,
          to: existing.to,
        },
      ];
    }
    case "edgeRemove": {
      const existing = doc.edges.find((e) => e.id === op.id);
      if (existing === undefined) return [];
      return [
        {
          op: "edgeAdd",
          id: existing.id,
          from: existing.from,
          to: existing.to,
        },
      ];
    }
    case "paramSet": {
      const module = doc.modules.find((m) => m.id === op.module);
      const previous = module?.params?.[op.param];
      // A param that had no explicit value has no "previous number" to restore. Setting it back to the
      // descriptor default is not the same thing, so the inverse is nothing and the value stays: an
      // honest limitation, and one the inspector avoids by writing an explicit value on first touch.
      if (previous === undefined) return [];
      return [
        { op: "paramSet", module: op.module, param: op.param, value: previous },
      ];
    }
    case "moduleMove": {
      const module = doc.modules.find((m) => m.id === op.id);
      if (module === undefined) return [];
      return [
        { op: "moduleMove", id: op.id, x: module.x ?? 0, y: module.y ?? 0 },
      ];
    }
  }
}
