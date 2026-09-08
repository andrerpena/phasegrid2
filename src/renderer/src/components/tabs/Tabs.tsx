import { cn } from "@renderer/utils/cn";
import { useRef } from "react";
import { Tab } from "./Tab";
import type { TabsProps } from "./types";
import { useTabs } from "./useTabs";

export function Tabs({
  tabs,
  activeTabId: controlledActiveTabId,
  defaultActiveTabId,
  onTabChange,
  onTabClose,
  variant = "primary",
  className,
  keepMounted = false,
  trailingAction,
}: TabsProps) {
  const tabListRef = useRef<HTMLDivElement>(null);

  const { activeTabId, setActiveTabId, handleClose } = useTabs({
    tabs,
    activeTabId: controlledActiveTabId,
    defaultActiveTabId,
    onTabChange,
    onTabClose,
  });

  const activeTab = keepMounted ? null : tabs.find((t) => t.id === activeTabId);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const currentIndex = tabs.findIndex((t) => t.id === activeTabId);

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
      setActiveTabId(tabs[prevIndex].id);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const nextIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
      setActiveTabId(tabs[nextIndex].id);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveTabId(tabs[0].id);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveTabId(tabs[tabs.length - 1].id);
    }
  };

  if (tabs.length === 0) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center text-muted-foreground",
          className,
        )}
      >
        No tabs
      </div>
    );
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Tab List */}
      <div
        ref={tabListRef}
        role="tablist"
        aria-label="Tabs"
        onKeyDown={handleKeyDown}
        className={cn(
          "flex shrink-0 overflow-x-auto",
          variant === "primary" && "bg-secondary border-b border-border",
          variant === "secondary" && "border-b border-border",
        )}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            variant={variant}
            onSelect={setActiveTabId}
            onClose={tab.closable ? handleClose : undefined}
          />
        ))}
        {trailingAction && (
          <div className="ml-auto flex items-center shrink-0 px-1">
            {trailingAction}
          </div>
        )}
      </div>

      {/* Tab Panel(s) */}
      {keepMounted ? (
        // Render all panels, hide inactive ones with CSS
        <div className="flex-1 min-h-0 min-w-0 relative">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              id={`tabpanel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={tab.id}
              aria-hidden={tab.id !== activeTabId}
              className={cn(
                "absolute inset-0",
                (tab.scrollable ?? true)
                  ? "overflow-y-auto"
                  : "overflow-hidden",
                tab.id === activeTabId
                  ? "visible z-10"
                  : "invisible z-0 pointer-events-none",
              )}
            >
              {tab.content}
            </div>
          ))}
        </div>
      ) : (
        // Only render active panel
        <div
          id={`tabpanel-${activeTabId}`}
          role="tabpanel"
          aria-labelledby={activeTabId}
          className={cn(
            "flex-1 min-h-0 min-w-0",
            (activeTab?.scrollable ?? true)
              ? "overflow-y-auto"
              : "overflow-hidden",
          )}
        >
          {activeTab?.content}
        </div>
      )}
    </div>
  );
}
