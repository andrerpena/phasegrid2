import { useLogStore } from "@renderer/log/log-store";
import { cn } from "@renderer/utils/cn";
import { ScrollText } from "lucide-react";
import { useEffect, useRef } from "react";
import type { WidgetDefinition } from "../types";

/**
 * What the engine and the application have said, newest at the bottom, following as it grows.
 *
 * One line per entry, coloured by level and prefixed by where it came from, so an engine that
 * restarts, refuses a device or rejects a patch says so somewhere a person can read it.
 */
const LogWidgetComponent = () => {
  const entries = useLogStore((s) => s.entries);
  const end = useRef<HTMLDivElement>(null);

  // Follows the newest line, the way a terminal does. Someone reading an older line while the log
  // grows is a case worth handling when the log is long enough for it to happen.
  const count = entries.length;
  useEffect(() => {
    if (count > 0) end.current?.scrollIntoView({ block: "end" });
  }, [count]);

  if (entries.length === 0)
    return (
      <p className="m-0 p-3 text-xs text-muted-foreground">Nothing yet.</p>
    );

  return (
    <ol className="m-0 flex list-none flex-col p-1 font-mono text-2xs">
      {entries.map((entry, i) => (
        <li
          key={`${entry.time}-${i}`}
          className={cn(
            "whitespace-pre-wrap px-2 py-px",
            entry.level === "error" && "text-destructive",
            entry.level === "warn" && "text-signal-note",
            entry.level === "info" && "text-foreground",
            entry.level === "debug" && "text-muted-foreground",
          )}
        >
          <span className="text-muted-foreground">{entry.source} </span>
          {entry.message}
        </li>
      ))}
      <div ref={end} />
    </ol>
  );
};

export const logWidget: WidgetDefinition = {
  id: "log",
  label: "Log",
  icon: ScrollText,
  component: LogWidgetComponent,
  defaultSlot: "center-bottom",
  scope: "log",
};
