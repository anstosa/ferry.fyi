import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";
import { type Bulletin, Level } from "shared/contracts/bulletins";
import type { Terminal } from "shared/contracts/terminals";
import { hasRouteSubscription } from "shared/lib/alertSubscriptions";
import { isSuppressedBulletin } from "shared/lib/bulletins";
import { round } from "shared/lib/math";
import { capitalize } from "shared/lib/strings";

import { ExternalPillLink } from "~/components/ExternalPillLink";
import { InlineLoader } from "~/components/InlineLoader";
import { useUser } from "~/lib/user";
import UnsubscribedIcon from "~/static/images/icons/regular/bell.svg";
import SubscribedIcon from "~/static/images/icons/solid/bell.svg";
import BellAlertIcon from "~/static/images/icons/solid/bell-exclamation.svg";
import WarningIcon from "~/static/images/icons/solid/exclamation-triangle.svg";
import InfoIcon from "~/static/images/icons/solid/info-circle.svg";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";

import { Header } from "./Header";
import type { GetPath } from "./Route";

const WAIT_NUMBER_HOURS_MATCH = /^[^\d]*(\d+) (Hour|Hr) Wait.*$/i;
const WAIT_SPELL_HOURS_MATCH =
  /^.*(one|two|three|four|five|six)( 1\/2){0,1} (Hour|Hr) Wait.*$/i;
const WAIT_MINUTES_MATCH = /^[^\d]*(\d+) (Minute|Min) Wait.*$/i;
const HOURS_BY_SPELLED: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

interface BulletinLevelStyles {
  accent: string;
  badge: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
}

// bulletin severity style
const getBulletinLevelStyles = (level: Level): BulletinLevelStyles => {
  // high severity guard
  if (level === Level.HIGH) {
    return {
      accent: "bg-stale-light dark:bg-stale-dark",
      badge:
        "border-stale-light bg-stale-light text-white dark:border-stale-dark dark:bg-stale-dark dark:text-[#ffb3b0]",
      Icon: WarningIcon,
      label: "High impact",
    };
  }
  return {
    accent: "bg-blue-dark dark:bg-[#6fb8c8]",
    badge:
      "border-blue-dark bg-night-normal-light text-blue-dark dark:border-[#6fb8c8] dark:bg-blue-dark dark:text-[#b8e4f0]",
    Icon: InfoIcon,
    label: "Advisory",
  };
};

// active bulletin guard
const isActiveBulletin = (bulletin: Bulletin): boolean => {
  // low priority guard
  if (bulletin.level === Level.LOW) {
    return false;
  }
  // app-managed alert guard
  if (isSuppressedBulletin(bulletin)) {
    return false;
  }
  return true;
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

interface SubscribeLinkProps {
  getPath: GetPath;
  mate: Terminal | null;
  terminal: Terminal;
}

const SubscribeLink = ({
  getPath,
  mate,
  terminal,
}: SubscribeLinkProps): ReactElement => {
  const [{ alertSubscriptions, subscribedTerminals }] = useUser();
  const terminalIds = mate ? [terminal.id, mate.id] : [terminal.id];
  const isLegacySubscribed = terminalIds.some((terminalId) => {
    return subscribedTerminals?.includes(terminalId) ?? false;
  });
  const isSubscribed =
    hasRouteSubscription(alertSubscriptions, terminalIds) || isLegacySubscribed;
  const label = isSubscribed ? "Edit subscription" : "Subscribe";

  return (
    <Link
      className={clsx("button", {
        "button-invert": isSubscribed,
        "button-outline": !isSubscribed,
      })}
      to={getPath({ view: "subscribe" })}
    >
      <div className="button-icon">
        {isSubscribed ? <SubscribedIcon /> : <UnsubscribedIcon />}
      </div>
      <span className="button-label">{label}</span>
    </Link>
  );
};

const getBulletinTime = (
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

export const getLastBulletinTime = (terminal: Terminal): string => {
  const bulletin = terminal.bulletins[0];
  return getBulletinTime(bulletin);
};

interface Props {
  getPath: GetPath;
  terminal: Terminal | null;
  mate: Terminal | null;
  time: DateTime;
}

export const Bulletins = ({
  getPath,
  terminal,
  mate,
  time,
}: Props): ReactElement => {
  if (!terminal) {
    return <InlineLoader>Loading alerts...</InlineLoader>;
  }

  const activeBulletins = terminal.bulletins.filter((bulletin) => {
    // low priority guard
    return isActiveBulletin(bulletin);
  });

  const renderBulletin = (bulletin: Bulletin): ReactNode => {
    const { bodyHTML, date, level, routePrefix, title, url } = bulletin;
    const { accent, badge, Icon, label } = getBulletinLevelStyles(level);
    const filteredDescription = bodyHTML
      .replace(/<script>.*<\/script>/, "")
      .replace(/\s*style=".*"\s*/g, "")
      .replace(/<p>/g, '<p class="my-2 leading-relaxed">')
      .replace(/<ul>/g, '<ul class="my-2 list-disc space-y-1 pl-5">')
      .replace(
        /<a /g,
        '<a class="font-semibold text-blue-dark underline decoration-[#6fb8c8] underline-offset-2 dark:text-[#6fb8c8]" '
      );
    return (
      <li
        className={clsx(
          "relative overflow-hidden rounded-2xl border bg-white shadow-sm",
          "border-[rgba(0,0,0,0.08)]",
          "dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]"
        )}
        key={`${date}:${title}`}
      >
        <span className={clsx("absolute inset-y-0 left-0 w-1.5", accent)} />
        <article className="p-4 pl-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span
              className={clsx(
                "inline-flex items-center rounded-full border px-2.5 py-1",
                "text-2xs font-bold uppercase tracking-wide",
                badge
              )}
            >
              <Icon className="mr-1.5 h-3 w-3" />
              {label}
            </span>
            <span className="rounded-full bg-day-normal-light px-2.5 py-1 text-2xs font-semibold uppercase tracking-wide text-[#7a5400] dark:bg-[#261f00] dark:text-[#f2b705]">
              {getBulletinTime(bulletin, time)}
            </span>
            {routePrefix !== "All" && (
              <span className="rounded-full bg-night-normal-light px-2.5 py-1 text-2xs font-semibold uppercase tracking-wide text-blue-dark dark:bg-blue-dark dark:text-[#b8e4f0]">
                {routePrefix}
              </span>
            )}
          </div>
          <div className="flex items-start">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold leading-snug text-gray-darkest dark:text-white">
                {title}
              </h2>
              <div
                className="mt-2 text-sm leading-relaxed text-gray-dark dark:text-[#e0f0f4]"
                dangerouslySetInnerHTML={{ __html: filteredDescription }}
              />
              {url && (
                <ExternalPillLink className="mt-3" href={url}>
                  View WSF alert
                </ExternalPillLink>
              )}
            </div>
          </div>
        </article>
      </li>
    );
  };

  return (
    <>
      <Header
        share={{
          shareButtonText: "Share Alerts",
          sharedText: `Alerts for ${terminal.name} Ferry Terminal`,
        }}
        items={[
          ...(terminal.terminalUrl
            ? [
                {
                  Icon: WSDOTIcon,
                  label: "WSF Alerts Page",
                  url: terminal.terminalUrl,
                  isBottom: true,
                },
              ]
            : []),
        ]}
      >
        <span className="text-center flex-1">{terminal.name} Alerts</span>
      </Header>
      <main className="flex-grow overflow-y-scroll scrolling-touch bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
        <section className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
          <div
            className={clsx(
              "mb-4 overflow-hidden rounded-2xl border shadow-sm",
              "border-[rgba(0,0,0,0.08)]",
              "bg-[linear-gradient(135deg,#016f52_0%,#004d61_100%)]",
              "text-white"
            )}
          >
            <div className="p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15">
                    <BellAlertIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-2xs font-bold uppercase tracking-[0.16em] text-[#b8e4f0]">
                      Terminal alerts
                    </p>
                    <h1 className="mt-1 text-2xl font-bold leading-tight">
                      {terminal.name}
                    </h1>
                    <p className="mt-2 text-sm leading-relaxed text-white/85">
                      {activeBulletins.length > 0
                        ? `${activeBulletins.length} active ${
                            activeBulletins.length === 1 ? "alert" : "alerts"
                          } from WSF`
                        : "No active service alerts right now"}
                    </p>
                  </div>
                </div>
                <div className="w-full sm:w-auto sm:shrink-0">
                  <SubscribeLink
                    getPath={getPath}
                    terminal={terminal}
                    mate={mate}
                  />
                </div>
              </div>
            </div>
          </div>
          {activeBulletins.length > 0 ? (
            <ul className="flex flex-col gap-4">
              {activeBulletins.map(renderBulletin)}
            </ul>
          ) : (
            <div
              className={clsx(
                "rounded-2xl border bg-white p-6 text-center shadow-sm",
                "border-[rgba(0,0,0,0.08)]",
                "dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]"
              )}
            >
              <BellAlertIcon className="mx-auto mb-3 h-8 w-8 text-blue-dark dark:text-[#6fb8c8]" />
              <h2 className="text-lg font-bold text-gray-darkest dark:text-white">
                All clear
              </h2>
              <p className="mt-2 text-sm text-gray-dark dark:text-[#b8d5de]">
                WSF has no active medium or high priority alerts for this
                terminal.
              </p>
            </div>
          )}
        </section>
      </main>
    </>
  );
};
