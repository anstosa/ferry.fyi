import { capitalize } from "~/lib/strings";
import { DateTime } from "luxon";
import { Order, sortBy } from "~/lib/arrays";
import { round } from "~/lib/math";
import clsx from "clsx";
import React, { FC, ReactNode } from "react";
import type { Bulletin, Terminal } from "shared/models/terminals";

const ALERT_FILTER = new RegExp(
  `(${[
    "boat",
    "advised",
    "cancelled",
    "emergency",
    "medical",
    "police",
    "tide",
    "traffic",
    "hour wait",
    "hr wait",
    "minute wait",
    "min wait",
    "without traffic",
  ].join("|")})`,
  "i"
);

const WAIT_NUMBER_HOURS_MATCH = /^[^\d]*(\d+) (Hour|Hr) Wait.*$/i;
const WAIT_SPELL_HOURS_MATCH = /^.*(one|two|three|four|five|six)( 1\/2){0,1} (Hour|Hr) Wait.*$/i;
const WAIT_MINUTES_MATCH = /^[^\d]*(\d+) (Minute|Min) Wait.*$/i;
const HOURS_BY_SPELLED: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

export const getWaitTime = ({ title }: Bulletin): string | null => {
  let match = title.match(WAIT_NUMBER_HOURS_MATCH);
  if (match) {
    const [, hours] = match;
    return `${hours}hr wait`;
  }

  match = title.match(WAIT_SPELL_HOURS_MATCH);
  if (match) {
    const [, hours, minutes] = match;
    return `${HOURS_BY_SPELLED[hours.toLowerCase()]}${
      minutes === "1/2" ? ".5" : ""
    }hr wait`;
  }

  match = title.match(WAIT_MINUTES_MATCH);
  if (match) {
    const [, minutesString] = match;
    const minutes = Number(minutesString);
    if (minutes >= 60) {
      return `${minutes / 60}hr wait`;
    } else {
      return `${minutes}min wait`;
    }
  }
  return null;
};

const getAlertTime = (
  bulletin: Bulletin,
  now: DateTime = DateTime.local()
): string => {
  const time = DateTime.fromSeconds(bulletin.date);
  const diff = time.diff(now);
  let result;
  if (Math.abs(diff.as("hours")) < 1) {
    const mins = round(Math.abs(diff.as("minutes")));
    result = `${mins} min${mins > 1 ? "s" : ""} ago`;
  } else if (time.hasSame(now, "day")) {
    result = time.toFormat("h:mm a");
  } else {
    result = capitalize(time.toRelativeCalendar() ?? "");
  }
  return result;
};

export const getLastAlertTime = (terminal: Terminal): string => {
  const bulletin = getBulletins(terminal)[0];
  return getAlertTime(bulletin);
};

export const getBulletins = ({ bulletins }: Terminal): Bulletin[] => {
  const filteredBulletins = bulletins.filter(({ title }) =>
    ALERT_FILTER.test(title)
  );
  return sortBy(filteredBulletins, "date", Order.DESC);
};

interface Props {
  terminal: Terminal;
  time: DateTime;
}

export const Alerts: FC<Props> = (props) => {
  const { terminal, time } = props;

  const renderAlert = (bulletin: Bulletin): ReactNode => {
    const { title, description } = bulletin;
    const filteredDescription = description
      .replace(/<script>.*<\/script>/, "")
      .replace(/\s*style=".*"\s*/g, "")
      .replace(/<p>/g, '<p class="my-2">')
      .replace(/<ul>/g, '<ul class="list-disc pl-4">');
    return (
      <li className="flex flex-col pb-8 relative" key={title}>
        <span className="text text-lighten-high text-bold mb-1">
          {getAlertTime(bulletin, time)}
        </span>
        <span className="font-medium text-lg mb-2">{title}</span>
        <div
          className="text-sm"
          dangerouslySetInnerHTML={{ __html: filteredDescription }}
        />
      </li>
    );
  };

  return (
    <aside className="flex-grow overflow-y-scroll scrolling-touch">
      <ul className={clsx("px-8 py-4 relative")}>
        {getBulletins(terminal).map(renderAlert)}
      </ul>
    </aside>
  );
};
