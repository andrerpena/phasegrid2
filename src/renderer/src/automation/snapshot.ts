import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { useModalStore } from "@renderer/components/floating/modal/modal-store";
import { useWidgetLayoutStore } from "@renderer/components/widgets/widget-layout-store";
import { useConfigStore } from "@renderer/config/config-store";
import { useEngineStore } from "@renderer/engine/engine-store";
import { useHistoryStore } from "@renderer/history/history-store";
import { useLayoutStore } from "@renderer/layout/layout-store";
import { type LogEntry, useLogStore } from "@renderer/log/log-store";
import { usePatchStore } from "@renderer/patch/patch-store";
import { useProjectStore } from "@renderer/project/project-store";
import { useSelectionStore } from "@renderer/selection/selection-store";
import { useThemeStore } from "@renderer/theming/theme-store";
import { useTransportStore } from "@renderer/transport/transport-store";
import { useWorkspaceStore } from "@renderer/workspace/workspace-store";
import type { PatchDoc } from "@shared/protocol/patch";
import type { ConfigRecord } from "@shared/protocol/storage";

/**
 * The whole application in one JSON object.
 *
 * Everything an agent, a script or a person at a REPL would otherwise have to find by reading
 * `innerText` or files on disk: which workspace is open, which projects, which is in front and
 * whether it is saved, the patch itself, the selection, what the engine is doing, what is undoable,
 * what the settings and layout resolved to, and what has been said. Plain data throughout, so it
 * crosses a debugger's `returnByValue` and prints as it is.
 */
export interface Snapshot {
  workspace: {
    status: string;
    root: string | null;
    name: string;
    projects: { slug: string; name: string }[];
    error: string | null;
  };
  projects: {
    open: {
      id: string;
      name: string;
      slug: string | null;
      dirty: boolean;
      tempo: number;
    }[];
    activeId: string | null;
  };
  patch: PatchDoc;
  selection: string[];
  engine: {
    status: string;
    detail: string;
    version: string | null;
    revision: number;
    running: boolean;
    capabilities: string[];
    hasTelemetry: boolean;
  };
  transport: { playing: boolean };
  catalog: { status: string; count: number; hash: string | null };
  history: { past: string[]; future: string[] };
  config: ConfigRecord;
  layout: {
    widgets: Record<string, string[]>;
    leftVisible: boolean;
    rightVisible: boolean;
    centerBottomVisible: boolean;
  };
  modals: string[];
  theme: string;
  log: LogEntry[];
}

export function buildSnapshot(logTail = 20): Snapshot {
  const workspace = useWorkspaceStore.getState();
  const project = useProjectStore.getState();
  const engine = useEngineStore.getState();
  const catalog = useCatalogStore.getState();
  const history = useHistoryStore.getState();
  const layout = useLayoutStore.getState();
  return {
    workspace: {
      status: workspace.status,
      root: workspace.root,
      name: workspace.name,
      projects: workspace.projects.map((p) => ({ slug: p.slug, name: p.name })),
      error: workspace.error,
    },
    projects: {
      open: project.projects.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug ?? null,
        dirty: project.isDirty(p.id),
        tempo: p.tempo,
      })),
      activeId: project.activeId,
    },
    patch: usePatchStore.getState().doc,
    selection: [...useSelectionStore.getState().modules],
    engine: {
      status: engine.status,
      detail: engine.detail,
      version: engine.engineVersion,
      revision: engine.revision,
      running: engine.running,
      capabilities: [...engine.capabilities],
      hasTelemetry: engine.shm !== null,
    },
    transport: { playing: useTransportStore.getState().playing },
    catalog: {
      status: catalog.status,
      count: catalog.modules.length,
      hash: catalog.hash,
    },
    history: {
      past: history.past.map((e) => e.label),
      future: history.future.map((e) => e.label),
    },
    config: useConfigStore.getState().computed,
    layout: {
      widgets: { ...useWidgetLayoutStore.getState().layout },
      leftVisible: layout.leftVisible,
      rightVisible: layout.rightVisible,
      centerBottomVisible: layout.centerBottomVisible,
    },
    modals: useModalStore.getState().stack.map((m) => m.id),
    theme: useThemeStore.getState().theme.id,
    log: useLogStore.getState().tail(logTail),
  };
}
