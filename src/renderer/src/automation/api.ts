import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { commandRegistry } from "@renderer/commands/registry";
import { useModalStore } from "@renderer/components/floating/modal/modal-store";
import { useWidgetLayoutStore } from "@renderer/components/widgets/widget-layout-store";
import { useConfigStore } from "@renderer/config/config-store";
import { useEngineStore } from "@renderer/engine/engine-store";
import { exampleFor } from "@renderer/examples/registry";
import { composeFace } from "@renderer/grid/face";
import { useHistoryStore } from "@renderer/history/history-store";
import { useLayoutStore } from "@renderer/layout/layout-store";
import { useLogStore } from "@renderer/log/log-store";
import { addModuleOp, uniqueEdgeId } from "@renderer/patch/add-module";
import { usePatchStore } from "@renderer/patch/patch-store";
import { useProjectStore } from "@renderer/project/project-store";
import { useSelectionStore } from "@renderer/selection/selection-store";
import { useThemeStore } from "@renderer/theming/theme-store";
import { useTransportStore } from "@renderer/transport/transport-store";
import { closeProject } from "@renderer/workspace/unsaved";
import { useWorkspaceStore } from "@renderer/workspace/workspace-store";
import type {
  CommandArgs,
  CommandName,
  CommandResult,
} from "@shared/protocol/commands";
import type { PatchOp, PortRef } from "@shared/protocol/patch";
import type { DialogAnswer, DialogKind } from "@shared/protocol/workspace";
import { createGridApi } from "./grid";
import { idle, waitFor } from "./idle";
import { buildSnapshot } from "./snapshot";

/**
 * `window.pg`: the application, driveable by name.
 *
 * Everything a person can do has a name here, and everything the interface shows can be read. It
 * exists so that a script -- an agent checking a change, a person at a REPL, a test -- can work in
 * the vocabulary the application already has (commands, patch operations, stores) instead of
 * finding buttons by their text and clicking canvas pixels by arithmetic. Always on, deliberately:
 * this is a tool for people who script things, and an automation surface is a feature.
 *
 * Reached over the DevTools protocol from `scripts/drive.mjs` and the e2e harness, or typed into
 * the developer console. Every function answers plain data, so a debugger's `returnByValue` can
 * carry it. See docs/automation.md.
 */

const UNKNOWN_SIZE = { width: 144, height: 96 };

function sizeOf(type: string): { width: number; height: number } {
  const descriptor = useCatalogStore.getState().get(type);
  if (descriptor === undefined) return UNKNOWN_SIZE;
  const face = composeFace(descriptor);
  return { width: face.width, height: face.height };
}

export function createAutomationApi() {
  const stores = {
    patch: usePatchStore,
    project: useProjectStore,
    selection: useSelectionStore,
    engine: useEngineStore,
    catalog: useCatalogStore,
    history: useHistoryStore,
    config: useConfigStore,
    layout: useLayoutStore,
    widgets: useWidgetLayoutStore,
    workspace: useWorkspaceStore,
    theme: useThemeStore,
    modal: useModalStore,
    transport: useTransportStore,
    log: useLogStore,
  };

  const api = {
    /** The whole application as one JSON object. `logTail` lines of the log at the end of it. */
    snapshot: (logTail?: number) => buildSnapshot(logTail),

    /** The zustand stores themselves, for what the snapshot does not summarise. */
    stores,

    /** Resolves when nothing is in flight. Use instead of a sleep. */
    idle,
    /** Polls until `predicate` holds, or throws. */
    waitFor,

    commands: {
      /** Every command the palette could run: id, name, category. */
      list: () =>
        commandRegistry
          .runnable()
          .map((c) => ({ id: c.id, name: c.name, category: c.category })),
      /** Runs one by id, as the palette or a key would. */
      run: (id: string, payload?: unknown) =>
        commandRegistry.dispatch(id, payload),
    },

    patch: {
      /** Applies operations to the document, undoable when labelled, and sends them to the engine. */
      apply: (ops: PatchOp[], label?: string) =>
        usePatchStore
          .getState()
          .apply(ops, label === undefined ? {} : { label }),
      /**
       * Adds a module of `type` and returns its id. The id and the spot are chosen the way the
       * catalogue chooses them unless given.
       */
      addModule: (
        type: string,
        options: { id?: string; x?: number; y?: number } = {},
      ): string => {
        const descriptor = useCatalogStore.getState().get(type);
        if (descriptor === undefined)
          throw new Error(`no module type ${type} in the catalogue`);
        const doc = usePatchStore.getState().doc;
        const op = addModuleOp(doc, descriptor, sizeOf, {
          x: options.x ?? 48,
          y: options.y ?? 48,
        });
        const placed: PatchOp =
          op.op === "moduleAdd"
            ? {
                ...op,
                id: options.id ?? op.id,
                x: options.x ?? op.x,
                y: options.y ?? op.y,
              }
            : op;
        usePatchStore
          .getState()
          .apply([placed], { label: `Add ${descriptor.name}` });
        return placed.op === "moduleAdd" ? placed.id : "";
      },
      /** A cable from an output to an input. Returns the edge id. */
      connect: (from: PortRef, to: PortRef): string => {
        const store = usePatchStore.getState();
        const id = uniqueEdgeId(store.doc);
        store.apply([{ op: "edgeAdd", id, from, to }], { label: "Connect" });
        return id;
      },
      /** Sets a parameter, as the inspector does: undoable, and sent through `param.set`. */
      setParam: (module: string, param: string, value: number) =>
        usePatchStore
          .getState()
          .apply([{ op: "paramSet", module, param, value }], {
            label: "Set parameter",
          }),
      /** Removes modules by id, cables included, as Delete does. */
      remove: (ids: string[]) =>
        usePatchStore.getState().apply(
          ids.map((id): PatchOp => ({ op: "moduleRemove", id })),
          {
            label:
              ids.length > 1 ? `Remove ${ids.length} modules` : "Remove module",
          },
        ),
      /** Selects modules by id, as clicking them would. */
      select: (ids: string[]) => useSelectionStore.getState().set(ids),
    },

    /** Where things on the canvas are, in window pixels. */
    grid: createGridApi(),

    workspace: {
      /** Opens a folder as the workspace, as the gate's dialog would. */
      openAt: (root: string) => useWorkspaceStore.getState().openAt(root),
      /** Opens a saved project by its folder name. */
      openProject: (slug: string) =>
        useWorkspaceStore.getState().openProject(slug),
      /** Saves the active project where it lives. False when it has nowhere to go. */
      save: (): Promise<boolean> => {
        const id = useProjectStore.getState().activeId;
        return id === null
          ? Promise.resolve(false)
          : useWorkspaceStore.getState().saveProject(id);
      },
      /** Saves the active project under a new name, as the Save As dialog would. */
      saveAs: (name: string): Promise<boolean> => {
        const id = useProjectStore.getState().activeId;
        return id === null
          ? Promise.resolve(false)
          : useWorkspaceStore.getState().saveProjectAs(id, name);
      },
      /** Closes a tab, asking about unsaved work exactly as the close button does. */
      closeProject: (id?: string): Promise<void> => {
        const target = id ?? useProjectStore.getState().activeId;
        return target === null ? Promise.resolve() : closeProject(target);
      },
      /**
       * Copies a module's example into the workspace and opens the copy, as the palette does.
       *
       * Resolves to whether it reached disk. The tab is there either way, so a scenario can go on
       * editing what it opened even in a workspace that refused the write.
       */
      copyExample: (moduleId: string): Promise<boolean> => {
        const example = exampleFor(moduleId);
        if (example === undefined)
          throw new Error(`no example for ${moduleId}`);
        return useWorkspaceStore.getState().copyExample(example);
      },
    },

    dialogs: {
      /**
       * Answers the next native dialog of `kind` ahead of time, so a flow that ends in one -- closing
       * a dirty tab, deleting a project, picking a folder -- can be driven to its end. `confirmUnsaved`
       * takes "save" | "discard" | "cancel", `confirmDelete` a boolean, `chooseWorkspace` a path or
       * null. Consumed once; with nothing queued the box appears as usual.
       */
      answer: (kind: DialogKind, answer: DialogAnswer) =>
        window.workspace.answerDialog(kind, answer),
    },

    engine: {
      /** The protocol, raw. */
      call: <C extends CommandName>(cmd: C, args: CommandArgs<C>) =>
        useEngineStore.getState().call(cmd, args) as Promise<CommandResult<C>>,
      /**
       * Renders the loaded patch offline and measures it: RMS and peak per channel, and a WAV at
       * `out` when given. The engine that is playing is untouched. How a script checks that what
       * it built makes a sound.
       */
      render: (options: { seconds?: number; out?: string } = {}) =>
        useEngineStore.getState().call("patch.render", options),
    },

    log: {
      /** The last `n` lines. */
      tail: (n = 20) => useLogStore.getState().tail(n),
      clear: () => useLogStore.getState().clear(),
    },

    /** What is here, one line each. For a person at a REPL. */
    help: (): string[] => HELP,
  };
  return api;
}

const HELP = [
  "pg.snapshot(logTail?)                 everything, as one JSON object",
  "pg.stores.<name>.getState()           patch, project, selection, engine, catalog, history, config, layout, widgets, workspace, theme, modal, transport, log",
  "pg.idle()                             resolves when nothing is in flight; use instead of a sleep",
  "pg.waitFor(() => cond, {timeoutMs})   polls a predicate",
  "pg.commands.list() / .run(id, payload?)",
  "pg.patch.apply(ops, label?) / .addModule(type, {id,x,y}?) / .connect(from, to) / .setParam(m, p, v) / .remove(ids) / .select(ids)",
  "pg.grid.canvas() / .viewport() / .node(id) / .nodes() / .port(module, port, side?) / .knob(module, param)   window pixels",
  "pg.workspace.openAt(root) / .openProject(slug) / .save() / .saveAs(name) / .closeProject(id?) / .copyExample(moduleId)",
  "pg.dialogs.answer(kind, answer)       the next native dialog of that kind answers this: confirmUnsaved save|discard|cancel, confirmDelete true|false, chooseWorkspace path|null",
  "pg.engine.call(cmd, args)             the protocol, raw",
  "pg.engine.render({seconds, out}?)     the loaded patch rendered offline: rms and peak per channel, a WAV at out",
  "pg.log.tail(n) / .clear()",
];

export type AutomationApi = ReturnType<typeof createAutomationApi>;
