import { Tabs } from "@renderer/components/tabs";
import type { TabItem } from "@renderer/components/tabs/types";
import { useConfigStore } from "@renderer/config/config-store";
import { DEFAULT_CONFIG } from "@renderer/config/defaults";
import { bindingsFromConfig } from "@renderer/keybindings/from-config";
import { useWorkspaceStore } from "@renderer/workspace/workspace-store";
import { useMemo, useState } from "react";
import { ConfigEditor } from "./ConfigEditor";
import { ConfigEditorToolbar } from "./ConfigEditorToolbar";

/**
 * The settings, in three views of the same thing.
 *
 * Overrides is what you wrote. Defaults is what shipped. Calculated is what the application is
 * actually running on. Three tabs rather than one, because "why is this value what it is" is the
 * question a settings file always eventually raises, and the answer is the difference between two of
 * these — which you cannot see if only one is shown.
 *
 * Only the first is editable. The other two are read-only editors rather than pre-formatted text so
 * that folding, searching and the same syntax colouring work in all three.
 */
type SettingsTab = "overrides" | "defaults" | "calculated";

export const SettingsContent = () => {
  const [tab, setTab] = useState<SettingsTab>("overrides");

  const text = useConfigStore((s) => s.overridesText);
  const parseError = useConfigStore((s) => s.parseError);
  const computed = useConfigStore((s) => s.computed);
  const setOverridesText = useConfigStore((s) => s.setOverridesText);
  const reset = useConfigStore((s) => s.reset);
  const root = useWorkspaceStore((s) => s.root);

  const defaultsJson = useMemo(
    () => JSON.stringify(DEFAULT_CONFIG, null, 2),
    [],
  );
  const computedJson = useMemo(
    () => JSON.stringify(computed, null, 2),
    [computed],
  );

  // Keybindings are the one setting that can leave the application unusable, so they are checked
  // here as well as where they are applied, and what was wrong is said out loud.
  const bindingError = bindingsFromConfig(computed.keybindings ?? null).error;

  const tabs: TabItem[] = useMemo(
    () => [
      {
        id: "overrides",
        label: "Overrides",
        scrollable: false,
        content: (
          <div className="flex h-full flex-col">
            <ConfigEditorToolbar
              readOnly={false}
              onReset={reset}
              parseError={parseError}
              bindingError={bindingError}
            />
            <div className="min-h-0 flex-1">
              <ConfigEditor value={text} onChange={setOverridesText} />
            </div>
          </div>
        ),
      },
      {
        id: "defaults",
        label: "Defaults",
        scrollable: false,
        content: (
          <div className="flex h-full flex-col">
            <ConfigEditorToolbar readOnly />
            <div className="min-h-0 flex-1">
              <ConfigEditor value={defaultsJson} readOnly />
            </div>
          </div>
        ),
      },
      {
        id: "calculated",
        label: "Calculated",
        scrollable: false,
        content: (
          <div className="flex h-full flex-col">
            <ConfigEditorToolbar readOnly />
            <div className="min-h-0 flex-1">
              <ConfigEditor value={computedJson} readOnly />
            </div>
          </div>
        ),
      },
    ],
    [
      text,
      defaultsJson,
      computedJson,
      parseError,
      bindingError,
      reset,
      setOverridesText,
    ],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Truncated from the left, because the end of a path is the part that identifies it. The
          `bdi` keeps the string reading left to right inside the right-to-left box. */}
      <p className="m-0 flex-none overflow-hidden text-ellipsis whitespace-nowrap border-b border-border px-2 py-1 text-left text-xs text-muted-foreground [direction:rtl]">
        <bdi dir="ltr">
          {root === null ? "No workspace" : `${root}/workspace.json`}
        </bdi>
      </p>
      <div className="min-h-0 flex-1">
        <Tabs
          tabs={tabs}
          activeTabId={tab}
          onTabChange={(id) => setTab(id as SettingsTab)}
          variant="secondary"
          // Three Monaco instances, kept alive: creating one is slow enough to see, and switching
          // tabs to compare a value against its default is exactly what these are for.
          keepMounted
          className="h-full"
        />
      </div>
    </div>
  );
};
