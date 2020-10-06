import { Bulletin, Terminal } from "../../server/lib/wsf";
import { capitalize, filter, map, reverse, round, sortBy } from "lodash";
import { DateTime } from "luxon";
import clsx from "clsx";
import React, { FunctionComponent, ReactNode } from "react";

const ALERT_FILTER = new RegExp(
  `(${[
    "boat",
    "cancelled",
    "emergency",
    "medical",
    "police",
    "tide",
    "traffic",
    "wait",
    "without traffic",
  ].join("|")})`,
  "i"
);

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
    result = capitalize(time.toRelativeCalendar() || "");
  }
  return result;
};

export const getLastAlertTime = (terminal: Terminal): string => {
  const bulletin = getBulletins(terminal)[0];
  return getAlertTime(bulletin);
};

export const getBulletins = ({ bulletins }: Terminal): Bulletin[] => {
  const filteredBulletins = filter(bulletins, ({ title }) =>
    ALERT_FILTER.test(title)
  );
  return reverse(sortBy(filteredBulletins, "date"));
};

interface Props {
  terminal: Terminal;
  time: DateTime;
}

export const Alerts: FunctionComponent<Props> = (props) => {
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
    <div className="flex-grow overflow-y-scroll scrolling-touch">
      <ul className={clsx("px-8 py-4 relative")}>
        {map(getBulletins(terminal), renderAlert)}
      </ul>
    </div>
  );
};
