import "./DateButton.scss";

import clsx from "clsx";
import { DateTime } from "luxon";
import React, { type ReactElement, useState } from "react";
import { DayPicker } from "react-day-picker";
import type { ValidRange } from "shared/contracts/schedules";

interface Props {
  onDateChange?: (date: DateTime) => void;
  defaultDate?: DateTime;
  validRange?: ValidRange;
}
// display the parent service date and notify only real calendar selections
export const DateButton = ({
  onDateChange,
  defaultDate,
  validRange,
}: Props): ReactElement => {
  const [isOpen, setOpen] = useState<boolean>(false);
  // retain a standalone selection when no parent date is supplied
  const [localDate, setLocalDate] = useState<DateTime>(() => DateTime.local());
  const date = defaultDate ?? localDate;
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

  return (
    <div
      className={clsx(
        "rounded border border-[rgba(1,111,82,0.18)]",
        "bg-day-normal-light text-green-dark shadow-sm",
        "dark:border-[rgba(255,255,255,0.08)] dark:bg-night-normal-dark dark:text-[#e0f0f4]",
        "relative flex flex-col items-center justify-center p-3",
        "cursor-pointer w-10 h-10",
        {
          "border-b-0 rounded-b-none": isOpen,
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
            className="date-button-picker"
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
              const nextDate = DateTime.fromJSDate(day);
              // retain selections locally only when the parent does not supply one
              if (!defaultDate) {
                setLocalDate(nextDate);
              }
              onDateChange?.(nextDate);
              setOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
};
