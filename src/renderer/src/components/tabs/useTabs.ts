import { useCallback, useEffect, useState } from "react";
import type { TabItem } from "./types";

interface UseTabsOptions {
  tabs: TabItem[];
  activeTabId?: string;
  defaultActiveTabId?: string;
  onTabChange?: (tabId: string) => void;
  onTabClose?: (tabId: string) => void;
}

interface UseTabsReturn {
  activeTabId: string | undefined;
  setActiveTabId: (tabId: string) => void;
  handleClose: (tabId: string) => void;
}

export function useTabs({
  tabs,
  activeTabId: controlledActiveTabId,
  defaultActiveTabId,
  onTabChange,
  onTabClose,
}: UseTabsOptions): UseTabsReturn {
  const isControlled = controlledActiveTabId !== undefined;

  const [internalActiveTabId, setInternalActiveTabId] = useState<
    string | undefined
  >(defaultActiveTabId ?? tabs[0]?.id);

  // Auto-select first tab when tabs change from empty to populated
  useEffect(() => {
    if (!isControlled && internalActiveTabId === undefined && tabs.length > 0) {
      setInternalActiveTabId(tabs[0].id);
    }
  }, [isControlled, internalActiveTabId, tabs]);

  const activeTabId = isControlled
    ? controlledActiveTabId
    : internalActiveTabId;

  const setActiveTabId = useCallback(
    (tabId: string) => {
      if (!isControlled) {
        setInternalActiveTabId(tabId);
      }
      onTabChange?.(tabId);
    },
    [isControlled, onTabChange],
  );

  const handleClose = useCallback(
    (tabId: string) => {
      onTabClose?.(tabId);

      // If closing the active tab, select an adjacent tab
      if (tabId === activeTabId) {
        const currentIndex = tabs.findIndex((t) => t.id === tabId);
        const nextTab = tabs[currentIndex + 1] ?? tabs[currentIndex - 1];
        if (nextTab) {
          setActiveTabId(nextTab.id);
        }
      }
    },
    [activeTabId, tabs, setActiveTabId, onTabClose],
  );

  return {
    activeTabId,
    setActiveTabId,
    handleClose,
  };
}
