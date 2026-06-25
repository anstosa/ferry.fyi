import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement, useEffect, useState } from "react";
import { DayPicker } from "react-day-picker";
import type { ValidRange } from "shared/contracts/schedules";

interface Props {
  onDateChange?: (date: DateTime) => void;
  defaultDate?: DateTime;
  validRange?: ValidRange;
}
export const DateButton = ({
  onDateChange,
  defaultDate,
  validRange,
}: Props): ReactElement => {
  const [isOpen, setOpen] = useState<boolean>(false);
  const [date, setDate] = useState<DateTime>(defaultDate || DateTime.local());
  const today = DateTime.local();
  // past date marker
  const pastDays = { before: today.startOf("day").toJSDate() };
  // future bounds
  const disabledDays = validRange
    ? [
        {
          after: DateTime.fromSeconds(validRange.to).toJSDate(),
        },
      ]
    : [];

  useEffect(() => onDateChange?.(date), [date]);

  return (
    <div
      className={clsx(
        "rounded border border-[rgba(1,111,82,0.18)]",
        "bg-day-normal-light text-green-dark shadow-sm",
        "dark:border-[rgba(255,255,255,0.08)] dark:bg-night-normal-dark dark:text-[#e0f0f4]",
        "relative flex flex-col items-center justify-center p-3",
        "cursor-pointer w-10 h-10",
        {
          "rounded-b-none": isOpen,
        }
      )}
      aria-label="Set Date"
      onClick={() => setOpen(!isOpen)}
    >
      {/* Background overlay. Click to close */}
      {isOpen && (
        <div
          className={clsx(
            "fixed w-screen h-screen top-0 left-0",
            "cursor-default"
          )}
          onClick={() => setOpen(false)}
        />
      )}
      <span className="text-xs mt-1">
        {date.month === today.month
          ? date.toFormat("ccc")
          : date.toFormat("MMM")}
      </span>
      <span className="text-lg font-bold -mt-1">{date.toFormat("d")}</span>
      <div onClick={(event) => event.stopPropagation()}>
        {isOpen && (
          <DayPicker
            className="date-button-picker absolute right-0 top-full"
            showOutsideDays
            disabled={disabledDays}
            modifiers={{ past: pastDays }}
            modifiersClassNames={{ past: "rdp-past" }}
            selected={date.toJSDate()}
            mode="single"
            weekStartsOn={1}
            onSelect={(day) => {
              // empty selection guard
              if (!day) {
                return;
              }
              setDate(DateTime.fromJSDate(day));
              setOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
};
