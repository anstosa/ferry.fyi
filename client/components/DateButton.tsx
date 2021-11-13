import { DateTime } from "luxon";
import { ValidRange } from "shared/contracts/schedules";
import clsx from "clsx";
import DayPicker from "react-day-picker";
import React, { ReactElement, useEffect, useState } from "react";

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

  useEffect(() => onDateChange?.(date), [date]);

  return (
    <div
      className={clsx(
        "rounded bg-white text-green-dark",
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
            className="absolute right-0 top-full"
            enableOutsideDaysClick
            showOutsideDays
            disabledDays={[
              {
                before: validRange
                  ? DateTime.fromSeconds(validRange.from).toJSDate()
                  : new Date(),
              },
              ...(validRange
                ? [
                    {
                      after: DateTime.fromSeconds(validRange.to).toJSDate(),
                    },
                  ]
                : []),
            ]}
            selectedDays={[date.toJSDate()]}
            firstDayOfWeek={1}
            onDayClick={(day) => {
              setDate(DateTime.fromJSDate(day));
              setOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
};
