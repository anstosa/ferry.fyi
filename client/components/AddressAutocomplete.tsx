import clsx from "clsx";
import React, { useEffect, useId, useRef, useState } from "react";
import type { AddressSuggestion } from "shared/contracts/addressSuggestions";

import { getAddressSuggestions } from "../lib/addressSuggestions";

interface Props {
  className?: string;
  disabled?: boolean;
  onChange: (value: string, placeId?: string) => void;
  value: string;
}

// keep google suggestions transient while the parent manages the shared address
export const AddressAutocomplete = ({
  className,
  disabled = false,
  onChange,
  value,
}: Props): React.ReactElement => {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState("idle");
  const identity = useRef(0);
  const dismissedValue = useRef<string | null>(null);
  const input = value.trim();
  const expanded = focused && suggestions.length > 0;

  // debounce edits and discard stale requests after dismissal or unmount
  useEffect(() => {
    const requestId = ++identity.current;
    setSuggestions([]);
    setActive(-1);
    setStatus("idle");
    // never acquire location or send short, selected or inactive addresses
    if (
      !focused ||
      disabled ||
      input.length < 3 ||
      input.length > 200 ||
      dismissedValue.current === value
    ) {
      return;
    }
    const timer = setTimeout(async () => {
      // skip a pending paid call after escape or pointer dismissal
      if (identity.current !== requestId) {
        return;
      }
      setStatus("loading");
      const result = await getAddressSuggestions(input);
      // ignore a response for an obsolete input or departed form
      if (identity.current !== requestId) {
        return;
      }
      setSuggestions(result.suggestions);
      // distinguish a working empty lookup from an unavailable provider
      if (result.available) {
        setStatus(result.suggestions.length === 0 ? "empty" : "idle");
      } else {
        // preserve manual entry without exposing provider details
        setStatus("unavailable");
      }
    }, 350);
    // cancel pending edits and invalidate network completions
    return () => {
      clearTimeout(timer);
      identity.current += 1;
    };
  }, [disabled, focused, input, value]);

  // dismiss without starting a new request for the selected address
  const dismiss = (): void => {
    identity.current += 1;
    dismissedValue.current = value;
    setSuggestions([]);
    setActive(-1);
    setStatus("idle");
  };

  // copy a suggestion into the existing explicit travel-estimate form
  const select = (suggestion: AddressSuggestion): void => {
    dismiss();
    dismissedValue.current = suggestion.address;
    onChange(suggestion.address, suggestion.placeId);
  };

  return (
    <div className="relative min-w-0">
      <div className="relative">
        <input
          aria-activedescendant={
            expanded && active >= 0 ? `${id}-option-${active}` : undefined
          }
          aria-autocomplete="list"
          aria-busy={status === "loading"}
          aria-controls={expanded ? `${id}-suggestions` : undefined}
          aria-expanded={expanded}
          aria-label="Starting address"
          autoComplete="off"
          className={clsx("w-full pr-10", className)}
          disabled={disabled}
          maxLength={200}
          onBlur={() => {
            // close suggestions when focus leaves the address field
            dismiss();
            setFocused(false);
          }}
          onChange={(event) => {
            // invalidate immediately before the next debounced edit
            identity.current += 1;
            dismissedValue.current = null;
            setSuggestions([]);
            setActive(-1);
            setStatus("idle");
            onChange(event.target.value);
          }}
          onFocus={() => {
            // allow suggestions only while explicitly editing the field
            dismissedValue.current = null;
            setFocused(true);
          }}
          onKeyDown={(event) => {
            // escape dismisses the current dropdown without altering the address
            if (event.key === "Escape") {
              event.preventDefault();
              dismiss();
            }
            // keep keyboard selection inside the visible suggestion list
            if (
              expanded &&
              (event.key === "ArrowDown" || event.key === "ArrowUp")
            ) {
              event.preventDefault();
              const next =
                event.key === "ArrowDown"
                  ? (active + 1) % suggestions.length
                  : (active <= 0 ? suggestions.length : active) - 1;
              setActive(next);
            }
            // let the parent handle selection without a duplicate form submission
            if (expanded && active >= 0 && event.key === "Enter") {
              event.preventDefault();
              select(suggestions[active]);
            }
          }}
          placeholder="Starting address"
          role="combobox"
          type="text"
          value={value}
        />
        {/* keep loading feedback inside the input's reserved trailing space */}
        {status === "loading" && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
          >
            <span className="block h-4 w-4 animate-spin rounded-full border-2 border-green-light border-t-green-dark motion-reduce:animate-none dark:border-green-dark dark:border-t-green-light" />
          </span>
        )}
      </div>
      {expanded && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-black/15 bg-white shadow-lg dark:border-white/20 dark:bg-blue-darkest">
          <ul
            aria-label="Address suggestions"
            id={`${id}-suggestions`}
            role="listbox"
          >
            {suggestions.map((suggestion, index) => {
              // show only escaped prediction text with an accessible selection
              return (
                <li
                  aria-selected={active === index}
                  className={clsx(
                    "cursor-pointer px-3 py-3 text-sm hover:bg-green-lightest dark:hover:bg-green-dark/30",
                    active === index &&
                      "bg-green-lightest dark:bg-green-dark/30"
                  )}
                  id={`${id}-option-${index}`}
                  key={suggestion.placeId}
                  onClick={() => {
                    // select with pointer input while leaving submission explicit
                    select(suggestion);
                  }}
                  onMouseDown={(event) => {
                    // retain input focus until the pointer selection completes
                    event.preventDefault();
                  }}
                  role="option"
                >
                  <span className="block font-semibold">
                    {suggestion.primaryText}
                  </span>
                  <span className="block text-xs text-gray-dark dark:text-gray-light">
                    {suggestion.secondaryText}
                  </span>
                </li>
              );
            })}
          </ul>
          <p
            className="whitespace-nowrap border-t border-black/10 px-3 py-2 text-right font-sans text-xs font-normal not-italic tracking-normal text-[#5e5e5e] dark:border-white/10 dark:text-white"
            translate="no"
          >
            Google Maps
          </p>
        </div>
      )}
      <p
        aria-live="polite"
        className={clsx(
          "text-xs text-gray-dark dark:text-gray-light",
          status === "empty" || status === "unavailable" ? "mt-1" : "sr-only"
        )}
        role="status"
      >
        {status === "loading" && "Finding addresses…"}
        {status === "empty" &&
          "No matching addresses. You can still enter one manually."}
        {status === "unavailable" &&
          "Address suggestions are unavailable. You can still enter an address."}
      </p>
    </div>
  );
};
