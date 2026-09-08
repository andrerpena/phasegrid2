import { useHistoryStore } from "@renderer/history/history-store";
import { cn } from "@renderer/utils/cn";
import { History } from "lucide-react";
import type { WidgetDefinition } from "../types";

/**
 * What you have done, and what you have taken back.
 *
 * The two lists the store keeps, shown as one: everything done so far, then everything undone,
 * dimmed. Undone entries stay on screen because redo is only discoverable if you can see there is
 * something to redo — a list that simply got shorter tells you nothing about what you would get
 * back.
 *
 * The newest done entry is the one undo takes next, so it is marked.
 */
const HistoryWidgetComponent = () => {
  const past = useHistoryStore((s) => s.past);
  const future = useHistoryStore((s) => s.future);

  if (past.length === 0 && future.length === 0)
    return (
      <p className="m-0 p-3 text-xs text-muted-foreground">Nothing yet.</p>
    );

  return (
    <ol className="m-0 flex list-none flex-col gap-px p-1 text-xs">
      {past.map((entry, i) => (
        // Entries have no identity of their own -- they are a label and two functions -- and the
        // list only ever grows or shrinks at its ends, so the position is a stable enough key.
        <li
          key={`past-${i}-${entry.label}`}
          className={cn(
            "truncate rounded-sm px-2 py-0.5",
            i === past.length - 1
              ? "bg-card text-foreground"
              : "text-muted-foreground",
          )}
        >
          {entry.label}
        </li>
      ))}
      {future.map((entry, i) => (
        <li
          key={`future-${i}-${entry.label}`}
          className="truncate rounded-sm px-2 py-0.5 text-muted-foreground opacity-50"
        >
          {entry.label}
        </li>
      ))}
    </ol>
  );
};

export const historyWidget: WidgetDefinition = {
  id: "history",
  label: "History",
  icon: History,
  component: HistoryWidgetComponent,
  defaultSlot: "left-bottom",
  scope: "history",
};
