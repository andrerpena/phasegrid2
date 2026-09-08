import {
  catalogWidget,
  gridWidget,
  historyWidget,
  inspectorWidget,
  logWidget,
  performanceWidget,
  projectsWidget,
  scopeWidget,
  settingsWidget,
} from "./definitions";
import { refreshWidgetLayout } from "./widget-layout-store";
import { widgetRegistry } from "./widget-registry";

/**
 * Every widget this build has. Called once at startup.
 *
 * The layout is re-read afterwards, because reading it before this ran would have dropped every name
 * in the settings file as unknown -- normalising a layout means checking each id against the registry,
 * and an empty registry recognises nothing.
 */
export function registerBuiltInWidgets(): void {
  widgetRegistry.register(gridWidget);
  widgetRegistry.register(settingsWidget);
  widgetRegistry.register(catalogWidget);
  widgetRegistry.register(projectsWidget);
  widgetRegistry.register(historyWidget);
  widgetRegistry.register(inspectorWidget);
  widgetRegistry.register(logWidget);
  widgetRegistry.register(scopeWidget);
  widgetRegistry.register(performanceWidget);
  refreshWidgetLayout();
}
