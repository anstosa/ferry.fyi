import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import React, { MouseEvent, ReactElement } from "react";

import { useWindowSize } from "~/lib/window";
import CaretDownIcon from "~/static/images/icons/solid/caret-down.svg";
import CaretUpIcon from "~/static/images/icons/solid/caret-up.svg";

const ABBREVIATION_BREAKPOINT = 350;

interface HeaderDropdownProps<Option> {
  ariaLabel: string;
  getKey: (option: Option) => string;
  getLabel: (option: Option) => string;
  getShortLabel: (option: Option) => string;
  isOpen: boolean;
  onSelect: (event: MouseEvent, option: Option) => void;
  options: Option[];
  selectedLabel: string;
  selectedShortLabel: string;
  setOpen: (state: boolean) => void;
}

// header dropdown render
export const HeaderDropdown = <Option,>({
  ariaLabel,
  getKey,
  getLabel,
  getShortLabel,
  isOpen,
  onSelect,
  options,
  selectedLabel,
  selectedShortLabel,
  setOpen,
}: HeaderDropdownProps<Option>): ReactElement => {
  const { width } = useWindowSize();
  const selectedText =
    width > ABBREVIATION_BREAKPOINT ? selectedLabel : selectedShortLabel;
  // empty options guard
  if (options.length === 0) {
    return <span className="truncate">{selectedText}</span>;
  }
  return (
    <div className="relative min-w-0 cursor-pointer">
      <div
        aria-label={ariaLabel}
        className="flex min-w-0 items-center"
        onClick={() => setOpen(!isOpen)}
      >
        <span className="truncate">{selectedText}</span>
        <div
          className={clsx(
            "absolute top-full -mt-1 flex w-full justify-center",
            "text-lighten-medium"
          )}
        >
          {isOpen ? <CaretUpIcon /> : <CaretDownIcon />}
        </div>
      </div>
      {/* menu backdrop */}
      {isOpen && (
        <div
          className="fixed left-0 top-0 h-screen w-screen cursor-default"
          onClick={() => setOpen(false)}
        />
      )}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className={clsx(
              "absolute left-1/2 top-full z-30 -translate-x-1/2",
              "max-h-[calc(100vh-4rem)] overflow-y-auto scrolling-touch",
              "bg-green-dark py-2 shadow-lg"
            )}
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut", type: "tween" }}
          >
            <ul>
              {options.map((option) => {
                return (
                  <li key={getKey(option)}>
                    <button
                      className={clsx(
                        "block w-full cursor-pointer whitespace-nowrap",
                        "px-8 py-2 text-left hover:bg-lighten-high"
                      )}
                      onClick={(event) => onSelect(event, option)}
                      type="button"
                    >
                      <span className="max-[350px]:hidden">
                        {getLabel(option)}
                      </span>
                      <span className="hidden max-[350px]:inline">
                        {getShortLabel(option)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
