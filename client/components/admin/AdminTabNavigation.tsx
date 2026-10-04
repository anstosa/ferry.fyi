import clsx from "clsx";
import React, { ReactElement, useEffect, useRef, useState } from "react";

export interface AdminTabItem {
  id: string;
  label: string;
}

interface Props {
  activeTab: string;
  onSelect: (tab: string) => void;
  tabs: readonly AdminTabItem[];
}

// provide desktop tabs and a bounded mobile menu
export const AdminTabNavigation = ({
  activeTab,
  onSelect,
  tabs,
}: Props): ReactElement => {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(
    0,
    tabs.findIndex(({ id }) => id === activeTab)
  );
  const activeLabel = tabs[activeIndex]?.label ?? "Admin tools";

  // close the mobile menu after an outside click
  useEffect(() => {
    // skip document listeners while closed
    if (!open) {
      return;
    }
    const closeOutside = (event: PointerEvent): void => {
      // retain clicks within the tab control
      if (containerRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    // release the temporary document listener
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  // focus the keyboard-selected menu option
  useEffect(() => {
    // focus only visible options
    if (open) {
      optionRefs.current[focusedIndex]?.focus();
    }
  }, [focusedIndex, open]);

  // open the mobile menu at one option
  const openAt = (index: number): void => {
    setFocusedIndex(index);
    setOpen(true);
  };

  // close the menu and restore its trigger
  const closeAndFocus = (): void => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  // commit one tab selection
  const selectTab = (index: number): void => {
    const tab = tabs[index];
    // reject an obsolete option index
    if (!tab) {
      return;
    }
    onSelect(tab.id);
    closeAndFocus();
  };

  // navigate the open mobile listbox
  const handleListKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>
  ): void => {
    // close without changing tabs
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndFocus();
      return;
    }
    // choose the focused option
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectTab(focusedIndex);
      return;
    }
    let next = focusedIndex;
    // move through the option list
    if (event.key === "ArrowDown") {
      next = (focusedIndex + 1) % tabs.length;
    } else if (event.key === "ArrowUp") {
      next = (focusedIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    setFocusedIndex(next);
  };

  return (
    <>
      <div className="relative mb-4 sm:hidden" ref={containerRef}>
        <button
          aria-controls="admin-mobile-tab-options"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label="Choose admin tool"
          className="flex w-full items-center justify-between rounded-xl border border-gray-medium bg-white px-4 py-3 text-left font-semibold text-gray-darkest shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-dark dark:border-gray-dark dark:bg-blue-dark dark:text-white dark:focus-visible:outline-green-light"
          onClick={() => {
            // toggle from the currently active tab
            if (open) {
              setOpen(false);
            } else {
              openAt(activeIndex);
            }
          }}
          onKeyDown={(event) => {
            // open at a predictable keyboard destination
            if (
              event.key === "ArrowDown" ||
              event.key === "ArrowUp" ||
              event.key === "Home" ||
              event.key === "End"
            ) {
              event.preventDefault();
              let destination = activeIndex;
              // open at the last option
              if (event.key === "End") {
                destination = tabs.length - 1;
              }
              // open at the first option
              if (event.key === "Home") {
                destination = 0;
              }
              openAt(destination);
            }
          }}
          ref={triggerRef}
          type="button"
        >
          <span>{activeLabel}</span>
          <span aria-hidden>{open ? "▲" : "▼"}</span>
        </button>
        {open && (
          <div
            aria-label="Admin tools"
            className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-gray-medium bg-white p-1 shadow-xl dark:border-gray-dark dark:bg-blue-darkest"
            id="admin-mobile-tab-options"
            onKeyDown={handleListKeyDown}
            role="listbox"
          >
            {tabs.map((tab, index) => (
              <button
                aria-selected={tab.id === activeTab}
                className={clsx(
                  "block w-full rounded-lg px-3 py-3 text-left text-sm font-semibold focus:outline-none",
                  tab.id === activeTab
                    ? "bg-green-dark text-white"
                    : "text-gray-darkest hover:bg-gray-lightest focus:bg-gray-lightest dark:text-gray-light dark:hover:bg-blue-dark dark:focus:bg-blue-dark"
                )}
                key={tab.id}
                onClick={() => {
                  // select one mobile admin tab
                  selectTab(index);
                }}
                ref={(element) => {
                  // retain option focus targets
                  optionRefs.current[index] = element;
                }}
                role="option"
                tabIndex={index === focusedIndex ? 0 : -1}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        aria-label="Admin tools"
        className="mb-4 hidden gap-5 overflow-x-auto overflow-y-hidden border-b border-gray-light sm:flex dark:border-gray-dark"
        role="tablist"
      >
        {tabs.map((tab) => (
          <button
            aria-controls={`admin-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            className={clsx(
              "-mb-px whitespace-nowrap border-b-2 px-1 pb-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-dark dark:focus-visible:outline-green-light",
              activeTab === tab.id
                ? "border-green-dark text-green-dark dark:border-green-light dark:text-green-light"
                : "border-transparent text-gray-dark hover:border-gray-medium hover:text-gray-darkest dark:text-gray-light dark:hover:border-gray-medium dark:hover:text-white"
            )}
            id={`admin-tab-${tab.id}`}
            key={tab.id}
            onClick={() => {
              // select one desktop admin tab
              onSelect(tab.id);
            }}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
    </>
  );
};
