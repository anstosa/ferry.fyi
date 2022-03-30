import { Bulletin } from "shared/contracts/bulletins";
import { capitalize } from "shared/lib/strings";
import { DateTime } from "luxon";
import { Header } from "./Header";
import { InlineLoader } from "~/components/InlineLoader";
import { round } from "shared/lib/math";
import { useAuth0 } from "@auth0/auth0-react";
import { useLocation } from "react-router-dom";
import { useUser } from "~/lib/user";
import { without } from "shared/lib/arrays";
import clsx from "clsx";
import React, { ReactElement, ReactNode, useState } from "react";
import SubscribedIcon from "~/static/images/icons/solid/bell.svg";
import UnsubscribedIcon from "~/static/images/icons/regular/bell.svg";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";
import type { Terminal } from "shared/contracts/terminals";

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
  const bulletin = terminal.bulletins[0];
  return getAlertTime(bulletin);
};

interface Props {
  terminal: Terminal | null;
  time: DateTime;
}

export const Alerts = ({ terminal, time }: Props): ReactElement => {
  const [isSubscribing, setSubscribing] = useState<boolean>(false);
  const [{ subscribedTerminals = [], isAuthenticated }, { updateUser }] =
    useUser();
  const { loginWithRedirect } = useAuth0();
  const location = useLocation();

  if (!terminal) {
    return <InlineLoader>Loading cameras...</InlineLoader>;
  }

  const isSubscribed = subscribedTerminals.includes(terminal.id);
  const renderAlert = (bulletin: Bulletin): ReactNode => {
    const { title, descriptionHTML } = bulletin;
    const filteredDescription = descriptionHTML
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
        <button
          className={clsx("button", {
            "button-invert": isSubscribed,
            "button-outline": !isSubscribed,
          })}
          onClick={async () => {
            if (!isAuthenticated) {
              loginWithRedirect({
                appState: { redirectPath: location.pathname },
                redirectUri: process.env.AUTH0_CLIENT_REDIRECT,
              });
              return;
            } else if (isSubscribed) {
              setSubscribing(true);
              await updateUser({
                app_metadata: {
                  subscribedTerminals: without(
                    subscribedTerminals,
                    terminal.id
                  ),
                },
              });
            } else {
              setSubscribing(true);
              await updateUser({
                app_metadata: {
                  subscribedTerminals: [...subscribedTerminals, terminal.id],
                },
              });
            }
            setSubscribing(false);
          }}
        >
          <div className="button-icon">
            {isSubscribed ? <SubscribedIcon /> : <UnsubscribedIcon />}
          </div>
          <span className="button-label">
            {/* eslint-disable-next-line no-nested-ternary */}
            {isSubscribing
              ? "Subscribing..."
              : isSubscribed
              ? "Unsubscribe"
              : "Subscribe"}
          </span>
        </button>
      </Header>
      <main className="flex-grow overflow-y-scroll scrolling-touch text-white">
        <ul className={clsx("px-8 py-4 relative")}>
          {terminal.bulletins.map(renderAlert)}
        </ul>
      </main>
    </>
  );
};
