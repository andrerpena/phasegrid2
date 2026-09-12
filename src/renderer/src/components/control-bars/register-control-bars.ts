import { controlBarRegistry } from "./control-bar-registry";
import { zoomControlBar } from "./definitions/ZoomControlBar";

export function registerBuiltInControlBars(): void {
  controlBarRegistry.register(zoomControlBar);
}
