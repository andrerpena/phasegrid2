import { useEngineStore } from "@renderer/engine/engine-store";
import { cn } from "@renderer/utils/cn";
import type { StatusBarItemDefinition } from "../types";

/** A dot and a word: whether the engine is alive, and what it last said. */
const EngineStatusBarComponent = () => {
  const status = useEngineStore((s) => s.status);
  const detail = useEngineStore((s) => s.detail);

  return (
    <span className="flex min-w-0 items-center gap-1.5" title={detail}>
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          status === "ready" && "bg-signal-note",
          status === "error" && "bg-destructive",
          status !== "ready" && status !== "error" && "bg-muted-foreground",
        )}
      />
      <span className="truncate">{detail}</span>
    </span>
  );
};

export const engineStatusBar: StatusBarItemDefinition = {
  id: "engine",
  component: EngineStatusBarComponent,
  defaultAlignment: "left",
};
