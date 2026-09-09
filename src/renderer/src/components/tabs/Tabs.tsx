import { cn } from "@renderer/utils/cn";
import { useRef } from "react";
import { Tab } from "./Tab";
import type { TabItem, TabsProps } from "./types";
import { useTabs } from "./useTabs";

/**
 * Which panels a kept-mounted strip renders, and which of them are hidden.
 *
 * Kept mounted means "not thrown away once built", not "built whether or not anyone looks". A panel
 * nobody has opened is not rendered at all: the settings panel loads a code editor of several
 * megabytes behind a dynamic import precisely so that a launch does not pay for a panel most
 * launches never open, and mounting it eagerly quietly undid that.
 *
 * Hidden is the `hidden` attribute, which is `display: none` and cannot be undone from inside. It
 * was `visibility: hidden`, which a descendant can override -- and the settings panel's own inner
 * tab strip did, with a `visible` on its active panel, so its toolbar and editor painted over the
 * grid whenever the Grid tab was the one selected.
 */
export function keptPanels(
  tabs: TabItem[],
  activeTabId: string | undefined,
  everShown: ReadonlySet<string>,
): { tab: TabItem; hidden: boolean }[] {
  return tabs
    .filter((tab) => everShown.has(tab.id))
    .map((tab) => ({ tab, hidden: tab.id !== activeTabId }));
}

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

  /**
   * Every tab that has been in front. Accumulated during render rather than in an effect, so the
   * first render of a newly selected panel is the one that mounts it; adding to a set is
   * idempotent, so a double render costs nothing.
   */
  const everShown = useRef(new Set<string>());

  const { activeTabId, setActiveTabId, handleClose } = useTabs({
    tabs,
    activeTabId: controlledActiveTabId,
    defaultActiveTabId,
    onTabChange,
    onTabClose,
  });

  const activeTab = keepMounted ? null : tabs.find((t) => t.id === activeTabId);
  if (keepMounted && activeTabId !== undefined)
    everShown.current.add(activeTabId);

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
        <div className="flex-1 min-h-0 min-w-0 relative">
          {keptPanels(tabs, activeTabId, everShown.current).map(
            ({ tab, hidden }) => (
              <div
                key={tab.id}
                id={`tabpanel-${tab.id}`}
                role="tabpanel"
                aria-labelledby={tab.id}
                hidden={hidden}
                className={cn(
                  "absolute inset-0",
                  (tab.scrollable ?? true)
                    ? "overflow-y-auto"
                    : "overflow-hidden",
                )}
              >
                {tab.content}
              </div>
            ),
          )}
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
