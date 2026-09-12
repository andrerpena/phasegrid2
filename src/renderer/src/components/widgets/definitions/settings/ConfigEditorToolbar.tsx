import { Button } from "@renderer/components/buttons/Button";
import { RotateCcw } from "lucide-react";

export interface ConfigEditorToolbarProps {
  onReset?: () => void;
  readOnly: boolean;
  parseError?: string | null;
  /** Said out loud beside the error, because a bad binding can leave the keyboard unusable. */
  bindingError?: string | null;
}

/**
 * The strip above the editor: whether what is typed is usable, and a way back to the defaults.
 *
 * No Save button. Settings are saved as they are typed — every keystroke that parses reaches
 * `workspace.json` — so a Save button would be a button that is never the thing standing between
 * your work and the disk. What the strip says instead is whether the text currently *does* parse,
 * which is the fact a Save button would have implied.
 */
export const ConfigEditorToolbar = ({
  onReset,
  readOnly,
  parseError,
  bindingError,
}: ConfigEditorToolbarProps) => {
  if (readOnly)
    return (
      <div className="flex h-8 flex-none items-center border-b border-border bg-secondary/40 px-3">
        <span className="text-xs text-muted-foreground">Read-only</span>
      </div>
    );

  return (
    <div className="flex h-8 flex-none items-center gap-2 border-b border-border px-1">
      <Button variant="outline" size="xs" onClick={onReset}>
        <RotateCcw />
        Reset
      </Button>
      {parseError !== null && parseError !== undefined ? (
        <span
          className="min-w-0 truncate text-xs text-destructive"
          title={parseError}
        >
          {parseError}
        </span>
      ) : bindingError !== null && bindingError !== undefined ? (
        <span className="min-w-0 truncate text-xs text-log-warn">
          keybindings: {bindingError}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Saved as you type</span>
      )}
    </div>
  );
};
