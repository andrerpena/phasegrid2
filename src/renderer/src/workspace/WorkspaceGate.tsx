import { Button } from "@renderer/components/buttons/Button";
import { useWorkspaceStore } from "./workspace-store";

/**
 * What you see before there is a workspace.
 *
 * Deliberately a gate rather than an empty shell. Everything in the application writes to a workspace or
 * reads from one, so a shell with no workspace behind it would offer a canvas you can build on and
 * cannot keep — and the moment to find that out is not after an hour's work.
 *
 * The engine connects behind this, so the catalogue is already loaded by the time a folder is picked.
 */
export const WorkspaceGate = () => {
  const status = useWorkspaceStore((s) => s.status);
  const recent = useWorkspaceStore((s) => s.recent);
  const error = useWorkspaceStore((s) => s.error);
  const choose = useWorkspaceStore((s) => s.choose);
  const openAt = useWorkspaceStore((s) => s.openAt);

  return (
    <div
      className="flex h-screen items-center justify-center bg-background p-4 text-foreground"
      data-kb-scope="workspace-gate"
    >
      <div className="flex w-full max-w-[34rem] flex-col items-start gap-3">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">phasegrid</h1>
        <p className="m-0 max-w-[46ch] text-sm leading-relaxed text-muted-foreground">
          A workspace is one folder holding your projects, your settings and the
          modules you build. Pick a folder to use as one — an empty one becomes
          a workspace, and one you have used before opens as it was.
        </p>

        <Button onClick={() => void choose()}>Open Workspace…</Button>

        {recent.length > 0 && (
          <>
            <h2 className="mt-2 mb-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recent
            </h2>
            <ul className="m-0 flex w-full list-none flex-col gap-px p-0">
              {recent.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer flex-col gap-0.5 rounded-sm px-2 py-1 text-left hover:bg-card"
                    onClick={() => void openAt(path)}
                    title={path}
                  >
                    {/* The folder's own name reads first, because that is what a person calls it; the
                        path underneath is what tells two folders of the same name apart. */}
                    <span className="text-sm">{path.split("/").at(-1)}</span>
                    {/* `rtl` keeps the end of a long path visible, which is the part that differs;
                        the `bdi` keeps the path itself reading left to right inside it. */}
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap text-left text-xs text-muted-foreground [direction:rtl]">
                      <bdi dir="ltr">{path}</bdi>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {error !== null && (
          <p className="m-0 text-xs text-destructive">{error}</p>
        )}
        {status === "booting" && (
          <p className="m-0 text-sm text-muted-foreground">Looking…</p>
        )}
      </div>
    </div>
  );
};
