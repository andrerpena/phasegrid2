import { Button } from "@renderer/components/buttons/Button";
import { useConfigStore } from "@renderer/config/config-store";
import { bindingsFromConfig } from "@renderer/keybindings/from-config";
import { useWorkspaceStore } from "@renderer/workspace/workspace-store";
import styles from "./SettingsPanel.module.css";

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
    <div className={styles.root} data-kb-scope="settings">
      <p className={styles.path}>
        {root === null ? "No workspace" : `${root}/workspace.json`}
      </p>
      <textarea
        className={styles.editor}
        value={text}
        spellCheck={false}
        aria-label="Workspace settings"
        onChange={(event) => setOverridesText(event.target.value)}
      />
      {parseError !== null && <p className={styles.error}>{parseError}</p>}
      {parseError === null && bindingError !== null && (
        <p className={styles.error}>keybindings: {bindingError}</p>
      )}

      <div className={styles.actions}>
        <Button size="sm" onClick={reset}>
          Reset
        </Button>
      </div>

      <h3 className={styles.heading}>Effective values</h3>
      <dl className={styles.values}>
        {Object.keys(defaults)
          .sort()
          .map((key) => (
            <div key={key} className={styles.value}>
              <dt className={styles.key}>{key}</dt>
              <dd
                className={styles.current}
                data-overridden={
                  JSON.stringify(computed[key]) !==
                  JSON.stringify(defaults[key])
                }
              >
                {JSON.stringify(computed[key])}
              </dd>
            </div>
          ))}
      </dl>
    </div>
  );
};
