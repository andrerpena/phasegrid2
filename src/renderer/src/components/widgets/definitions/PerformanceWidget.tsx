import { useEngineStore } from "@renderer/engine/engine-store";
import { Gauge } from "lucide-react";
import type { WidgetDefinition } from "../types";

const PerformanceWidgetComponent = () => {
  const status = useEngineStore((s) => s.status);
  const detail = useEngineStore((s) => s.detail);

  return (
    <dl className="m-0 flex flex-col gap-0.5 p-2 text-xs">
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">Engine</dt>
        <dd className="m-0">{status}</dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">Detail</dt>
        <dd className="m-0 truncate">{detail}</dd>
      </div>
    </dl>
  );
};

export const performanceWidget: WidgetDefinition = {
  id: "performance",
  label: "Performance",
  icon: Gauge,
  component: PerformanceWidgetComponent,
  defaultSlot: "right-bottom",
  scope: "performance",
};
