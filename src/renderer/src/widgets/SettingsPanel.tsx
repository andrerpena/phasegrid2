import { Button } from "@renderer/components/buttons/Button";
import { useConfigStore } from "@renderer/config/config-store";
import { bindingsFromConfig } from "@renderer/keybindings/from-config";
import { cn } from "@renderer/utils/cn";
import { useWorkspaceStore } from "@renderer/workspace/workspace-store";

/**
 * The settings, as the file they are.
 *
 * A text editor rather than a form, because the settings are a JSON object in the workspace and showing
 * anything else would be showing a picture of them. The defaults are listed underneath so a person can
 * see what there is to override without having to read the source.
 *
 * Text that does not parse stays on screen and never reaches the file: the store keeps running on the
 * last thing that made sense, which is what makes it possible to edit freely rather than in one
 * keystroke that has to be right.
 */
export const SettingsPanel = () => {
  const text = useConfigStore((s) => s.overridesText);
  const parseError = useConfigStore((s) => s.parseError);
  const defaults = useConfigStore((s) => s.defaults);
  const computed = useConfigStore((s) => s.computed);
  const setOverridesText = useConfigStore((s) => s.setOverridesText);
  const reset = useConfigStore((s) => s.reset);
  const root = useWorkspaceStore((s) => s.root);

  // Keybindings are the one setting that can leave the application unusable, so they are validated here
  // as well as when they are applied, and what was wrong is said out loud.
  const bindingError = bindingsFromConfig(computed.keybindings ?? null).error;

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2"
      data-kb-scope="settings"
    >
      {/* Truncated from the left, because the end of a path is the part that identifies it. The
          `bdi` keeps the string itself left-to-right inside the right-to-left box -- without it the
          leading slash is reordered to the end and the path reads as nonsense. */}
      <p className="m-0 overflow-hidden text-ellipsis whitespace-nowrap text-left text-xs text-muted-foreground [direction:rtl]">
        <bdi dir="ltr">
          {root === null ? "No workspace" : `${root}/workspace.json`}
        </bdi>
      </p>
      <textarea
        className="min-h-48 flex-none resize-y rounded-sm border border-border bg-input p-2 text-xs leading-relaxed text-foreground [tab-size:2]"
        value={text}
        spellCheck={false}
        aria-label="Workspace settings"
        onChange={(event) => setOverridesText(event.target.value)}
      />
      {parseError !== null && (
        <p className="m-0 text-xs text-destructive">{parseError}</p>
      )}
      {parseError === null && bindingError !== null && (
        <p className="m-0 text-xs text-destructive">
          keybindings: {bindingError}
        </p>
      )}

      <div className="flex gap-1">
        <Button variant="outline" size="sm" onClick={reset}>
          Reset
        </Button>
      </div>

      <h3 className="mt-2 mb-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Effective values
      </h3>
      <dl className="m-0 flex flex-col gap-0.5 text-xs">
        {Object.keys(defaults)
          .sort()
          .map((key) => (
            <div key={key} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{key}</dt>
              {/* What you changed should stand out from what came with the application. */}
              <dd
                className={cn(
                  "m-0 max-w-[55%] overflow-hidden text-ellipsis whitespace-nowrap",
                  JSON.stringify(computed[key]) !==
                    JSON.stringify(defaults[key])
                    ? "text-signal-note"
                    : "text-muted-foreground",
                )}
              >
                {JSON.stringify(computed[key])}
              </dd>
            </div>
          ))}
      </dl>
    </div>
  );
};
