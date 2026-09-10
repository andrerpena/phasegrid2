import { projectModelUri } from "@renderer/components/monaco-editor";
import { CodeEditor } from "@renderer/patch/editor/CodeEditor";
import { usePatchStore } from "@renderer/patch/patch-store";
import { useProjectStore } from "@renderer/project/project-store";
import { ProjectDocSchema } from "@shared/protocol/project";
import { useEffect, useMemo, useState } from "react";
import { projectText } from "./project-text";

/**
 * The project as the text Save writes, in an editor.
 *
 * The same document as the grid, seen the other way: `projectText` is the function the save path
 * uses, so what is on screen is byte for byte the file. Cmd+Enter (or Apply) parses the text, puts it
 * through the project schema, and replaces the document -- the way opening a file would -- so the
 * engine hears the patch and the header shows the tempo. Invalid JSON, or a shape the schema refuses,
 * is reported under the editor and changes nothing.
 */
export const SourceView = ({ id }: { id: string }) => {
  // Subscribed to, not fetched: the view has to re-render when either moves -- an apply here, or a grid
  // edit made while this was hidden.
  const patch = usePatchStore((s) => s.doc);
  const record = useProjectStore((s) => s.projects.find((p) => p.id === id));
  const isActive = useProjectStore((s) => s.activeId === id);
  const text = useMemo(() => {
    if (record === undefined) return "";
    // The live patch belongs to the active project; an inactive tab's is in its own record. The same
    // rule `snapshot()` follows, spelled out because a component must depend on what it reads.
    const rendered = projectText(isActive ? { ...record, patch } : record);
    return rendered.ok ? rendered.text : `// ${rendered.error}\n`;
  }, [record, patch, isActive]);

  const [draft, setDraft] = useState(text);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(text);
    setError(null);
  }, [text]);

  const apply = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (e) {
      setError(`Not JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const checked = ProjectDocSchema.safeParse(parsed);
    if (!checked.success) {
      setError(
        checked.error.issues
          .map(
            (issue) =>
              `${issue.path.join(".") || "document"}: ${issue.message}`,
          )
          .join("; "),
      );
      return;
    }
    if (!useProjectStore.getState().replace(id, checked.data)) {
      setError("This project is no longer open");
      return;
    }
    setError(null);
  };

  const dirty = draft !== text;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="source-view">
      <div className="min-h-0 flex-1">
        <CodeEditor
          value={draft}
          language="json"
          variant="document"
          modelUri={projectModelUri(id)}
          onChange={setDraft}
          onCommit={apply}
        />
      </div>
      <div className="flex min-h-7 items-center gap-2 border-t border-border bg-card px-2 text-xs">
        {error !== null ? (
          <span
            className="min-w-0 flex-1 truncate text-destructive"
            title={error}
          >
            {error}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {dirty
              ? "Edited. Cmd+Enter applies it to the project."
              : "This is the document Save writes. Edit it and press Cmd+Enter."}
          </span>
        )}
        <button
          type="button"
          className="flex-none cursor-pointer rounded-sm border border-border bg-card px-2 py-0.5 text-xs text-foreground enabled:hover:border-ring disabled:cursor-default disabled:text-muted-foreground"
          disabled={!dirty}
          onClick={apply}
        >
          Apply
        </button>
      </div>
    </div>
  );
};
