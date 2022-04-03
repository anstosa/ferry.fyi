import { AnimatePresence } from "framer-motion";
import { Bulletin, Level } from "shared/contracts/bulletins";
import { capitalize } from "shared/lib/strings";
import { DateTime } from "luxon";
import { Header } from "./Header";
import { InlineLoader } from "~/components/InlineLoader";
import { isNull, isUndefined } from "shared/lib/identity";
import { round } from "shared/lib/math";
import { Toast } from "~/components/Toast";
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

interface ButtonProps {
  terminalId: string;
  mateId?: string;
  dark?: boolean;
  showForMate?: (isSubscribed: boolean) => void;
  onChange?: () => void;
}

const SubscribeButton = ({
  terminalId,
  mateId,
  dark,
  showForMate,
  onChange,
}: ButtonProps): ReactElement => {
  const [isSubscribing, setSubscribing] = useState<boolean>(false);
  const [{ subscribedTerminals, isAuthenticated }, { updateUser }] = useUser();
  const { loginWithRedirect } = useAuth0();
  const location = useLocation();
  if (!subscribedTerminals) {
    return (
      <button className={clsx("button button-invert button-disabled")}>
        Loading...
      </button>
    );
  }
  const isSubscribed = subscribedTerminals.includes(terminalId);
  return (
    <button
      className={clsx("button", {
        "button-invert": isSubscribed,
        "button-outline": !isSubscribed,
        "border-green-dark text-green-dark": dark && !isSubscribed,
        "bg-green-dark text-white": dark && isSubscribed,
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
          if (!isUndefined(mateId) && subscribedTerminals.includes(mateId)) {
            showForMate?.(false);
          }
          await updateUser({
            app_metadata: {
              subscribedTerminals: without(subscribedTerminals, terminalId),
            },
          });
        } else {
          if (!isUndefined(mateId) && !subscribedTerminals.includes(mateId)) {
            showForMate?.(true);
          }
          setSubscribing(true);
          await updateUser({
            app_metadata: {
              subscribedTerminals: [...subscribedTerminals, terminalId],
            },
          });
        }
        setSubscribing(false);
        onChange?.();
      }}
    >
      <div className="button-icon">
        {isSubscribed ? <SubscribedIcon /> : <UnsubscribedIcon />}
      </div>
      <span className="button-label">
        {/* eslint-disable-next-line no-nested-ternary */}
        {isSubscribing
          ? "Loading..."
          : isSubscribed
          ? "Unsubscribe"
          : "Subscribe"}
      </span>
    </button>
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
  terminal: Terminal | null;
  mate: Terminal | null;
  time: DateTime;
}

export const Bulletins = ({ terminal, mate, time }: Props): ReactElement => {
  const [showMateSubscribePrompt, setMateSubscribePrompt] = useState<
    boolean | null
  >(null);

  if (!terminal) {
    return <InlineLoader>Loading cameras...</InlineLoader>;
  }

  const renderBulletin = (bulletin: Bulletin): ReactNode => {
    const { bodyHTML, level, routePrefix, title } = bulletin;
    if (level === Level.LOW) {
      return null;
    }
    const filteredDescription = bodyHTML
      .replace(/<script>.*<\/script>/, "")
      .replace(/\s*style=".*"\s*/g, "")
      .replace(/<p>/g, '<p class="my-2">')
      .replace(/<ul>/g, '<ul class="list-disc pl-4">');
    return (
      <li className="flex flex-col pb-8 relative" key={title}>
        <span className="text text-lighten-high text-bold mb-1">
          {getBulletinTime(bulletin, time)}
          {routePrefix === "All" ? "" : ` for ${routePrefix}`}
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
        <SubscribeButton
          terminalId={terminal.id}
          mateId={mate?.id}
          showForMate={setMateSubscribePrompt}
        />
      </Header>
      <main className="flex-grow overflow-y-scroll scrolling-touch text-white">
        <AnimatePresence>
          {!isNull(showMateSubscribePrompt) && mate && (
            <Toast
              info
              top
              onClose={() => {
                setMateSubscribePrompt(null);
              }}
            >
              <div className="flex flex-col gap-4 items-right">
                Also{" "}
                {showMateSubscribePrompt ? "subscribe to" : "unsubscribe from"}{" "}
                {mate?.name}?
                <SubscribeButton
                  dark
                  terminalId={mate.id}
                  onChange={() => setMateSubscribePrompt(null)}
                />
              </div>
            </Toast>
          )}
        </AnimatePresence>
        <ul className={clsx("px-8 py-4 relative")}>
          {terminal.bulletins.map(renderBulletin)}
        </ul>
      </main>
    </>
  );
};
