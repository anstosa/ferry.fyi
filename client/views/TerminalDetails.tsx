import clsx from "clsx";
import React, { ReactElement, ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import type { Terminal, TerminalInfo } from "shared/contracts/terminals";

import { ExternalPillLink } from "~/components/ExternalPillLink";
import { TerminalDropdown } from "~/components/TerminalDropdown";
import { locationToUrl } from "~/lib/maps";
import { getSlug, useTerminals } from "~/lib/terminals";
import CheckIcon from "~/static/images/icons/solid/check-circle.svg";
import InfoIcon from "~/static/images/icons/solid/info-circle.svg";
import LocationIcon from "~/static/images/icons/solid/location.svg";
import MapIcon from "~/static/images/icons/solid/map-marked.svg";
import UnavailableIcon from "~/static/images/icons/solid/times.svg";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";
import type { GetPath } from "~/views/Route";

import { Header } from "./Header";

interface Props {
  getPath: GetPath;
  mate: Terminal | null;
  setRoute: (target: string, mate?: string) => void;
  terminal: Terminal;
}

interface Facility {
  isAvailable: boolean;
  label: string;
}

interface InfoSection {
  key: keyof TerminalInfo;
  label: string;
}

const INFO_SECTIONS: InfoSection[] = [
  { key: "parking", label: "Parking" },
  { key: "bicycle", label: "Bicycles" },
  { key: "motorcycle", label: "Motorcycles" },
  { key: "truck", label: "Trucks" },
  { key: "construction", label: "Construction" },
  { key: "lost", label: "Lost and found" },
  { key: "airport", label: "Airport connections" },
  { key: "train", label: "Train connections" },
];

// visible html guard
const hasVisibleHtml = (html?: string): boolean => {
  // missing html guard
  if (!html) {
    return false;
  }
  return (
    html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim().length > 0
  );
};

// address lines
const getAddressLines = (terminal: Terminal): string[] => {
  const { address } = terminal.location;
  const cityLine = [address.city, address.state, address.zip]
    .filter(Boolean)
    .join(", ");
  return [address.line1, address.line2, cityLine].filter(
    (line): line is string => Boolean(line)
  );
};

// terminal facilities
const getFacilities = (terminal: Terminal): Facility[] => [
  { isAvailable: terminal.hasOverheadLoading, label: "Overhead loading" },
  { isAvailable: terminal.hasFood, label: "Vending machines" },
  { isAvailable: terminal.hasRestroom, label: "Restrooms" },
  { isAvailable: terminal.hasWaitingRoom, label: "Waiting room" },
];

// render detail card
const DetailCard = ({ children }: { children: ReactNode }): ReactElement => (
  <section
    className={clsx(
      "rounded-2xl border p-5 shadow-sm",
      "border-[rgba(0,0,0,0.08)] bg-white",
      "dark:border-[rgba(255,255,255,0.08)] dark:bg-blue-dark"
    )}
  >
    {children}
  </section>
);

export const TerminalDetails = ({
  getPath,
  mate,
  setRoute,
  terminal,
}: Props): ReactElement => {
  // terminal menu state
  const [isTerminalOpen, setTerminalOpen] = useState<boolean>(false);
  const { terminals, closestTerminal } = useTerminals();
  const addressLines = getAddressLines(terminal);
  const mapsUrl = terminal.location.link ?? locationToUrl(terminal.location);
  const facilities = getFacilities(terminal);
  const visibleInfoSections = INFO_SECTIONS.filter(({ key }) => {
    return hasVisibleHtml(terminal.info[key]);
  });
  const routeMates = terminal.mates ?? [];
  // route switcher guard
  const shouldShowRoutes = routeMates.length > 1;
  // accordion state
  const [openInfoKey, setOpenInfoKey] = useState<keyof TerminalInfo | null>(
    null
  );

  // render facility badge
  const renderFacility = ({ isAvailable, label }: Facility): ReactElement => {
    const Icon = isAvailable ? CheckIcon : UnavailableIcon;
    return (
      <li
        className={clsx(
          "flex items-center gap-3 rounded-xl border px-3 py-2",
          isAvailable
            ? "border-green-dark/20 bg-green-dark/10 text-green-dark dark:border-[#39ff88]/60 dark:bg-[#003f1c] dark:text-[#39ff88]"
            : "border-gray-300 bg-gray-100 text-gray-500 dark:border-white/5 dark:bg-white/[0.03] dark:text-white/35"
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="text-sm font-bold">{label}</span>
      </li>
    );
  };

  // render terminal info section
  const renderInfoSection = ({ key, label }: InfoSection): ReactElement => {
    const isOpen = openInfoKey === key;
    const contentId = `terminal-info-${key}`;
    return (
      <DetailCard key={key}>
        <button
          aria-controls={contentId}
          aria-expanded={isOpen}
          className={clsx(
            "flex w-full items-center justify-between gap-3 text-left",
            "text-lg font-bold text-gray-darkest dark:text-white"
          )}
          onClick={() => {
            setOpenInfoKey((currentKey) => (currentKey === key ? null : key));
          }}
          type="button"
        >
          <span>{label}</span>
          <span className="text-xl leading-none text-blue-dark dark:text-[#6fb8c8]">
            {isOpen ? "−" : "+"}
          </span>
        </button>
        {/* accordion content */}
        {isOpen && (
          <div
            className="mt-3 text-sm leading-relaxed text-gray-dark dark:text-[#e0f0f4]"
            dangerouslySetInnerHTML={{ __html: terminal.info[key] ?? "" }}
            id={contentId}
          />
        )}
      </DetailCard>
    );
  };

  return (
    <>
      <Header
        share={{
          shareButtonText: "Share Terminal",
          sharedText: `${terminal.name} Ferry Terminal details`,
        }}
        items={[
          ...(terminal.terminalUrl
            ? [
                {
                  Icon: WSDOTIcon,
                  label: "WSF Terminal Page",
                  url: terminal.terminalUrl,
                  isBottom: true,
                },
              ]
            : []),
        ]}
      >
        <div className="flex-1 min-w-0" />
        <div className="min-w-0 text-center">
          <TerminalDropdown
            terminals={terminals
              .filter(({ id }) => {
                // current terminal guard
                return id !== terminal.id;
              })
              .map((terminalOption) => {
                return {
                  ...(terminalOption.id === closestTerminal?.id && {
                    Icon: LocationIcon,
                  }),
                  terminal: terminalOption,
                };
              })}
            selected={terminal}
            isOpen={isTerminalOpen}
            setOpen={setTerminalOpen}
            onSelect={(event, selectedTerminal) => {
              event.preventDefault();
              setTerminalOpen(false);
              setRoute(getSlug(selectedTerminal.id));
            }}
          />
        </div>
        <span className="ml-2 shrink-0">Terminal</span>
        <div className="flex-1 min-w-0" />
      </Header>
      <main className="flex-grow overflow-y-scroll scrolling-touch bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 pb-8">
          <DetailCard>
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-green-dark text-lg font-black text-white shadow-sm">
                {terminal.abbreviation}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-black leading-tight text-gray-darkest dark:text-white">
                  {terminal.name}
                </h1>
              </div>
            </div>
            {/* address guard */}
            {addressLines.length > 0 && (
              <address className="mt-5 not-italic text-sm leading-relaxed text-gray-dark dark:text-[#e0f0f4]">
                {addressLines.map((line) => (
                  <span className="block" key={line}>
                    {line}
                  </span>
                ))}
              </address>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={clsx(
                  "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-bold",
                  "border-blue-dark text-blue-dark hover:bg-night-normal-light",
                  "dark:border-[#6fb8c8] dark:text-[#6fb8c8] dark:hover:bg-[rgba(255,255,255,0.08)]"
                )}
              >
                <MapIcon className="mr-2 h-3 w-3" />
                Open in Maps
              </a>
              {/* terminal url guard */}
              {terminal.terminalUrl && (
                <ExternalPillLink href={terminal.terminalUrl}>
                  WSF terminal page
                </ExternalPillLink>
              )}
            </div>
          </DetailCard>

          <DetailCard>
            <h2 className="mb-3 text-lg font-bold text-gray-darkest dark:text-white">
              Facilities
            </h2>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {facilities.map((facility) => renderFacility(facility))}
            </ul>
          </DetailCard>

          {/* route guard */}
          {shouldShowRoutes && (
            <DetailCard>
              <h2 className="mb-3 text-lg font-bold text-gray-darkest dark:text-white">
                Routes from {terminal.name}
              </h2>
              <div className="flex flex-wrap gap-2">
                {routeMates.map((routeMate) => (
                  <Link
                    key={routeMate.id}
                    to={getPath({
                      mate: routeMate,
                      terminal,
                      view: "schedule",
                    })}
                    className={clsx(
                      "rounded-full border px-3 py-1.5 text-sm font-bold",
                      routeMate.id === mate?.id
                        ? "border-green-dark bg-green-dark text-white dark:border-green-light dark:bg-green-light dark:text-blue-darkest"
                        : "border-blue-dark text-blue-dark hover:bg-night-normal-light dark:border-[#6fb8c8] dark:text-[#6fb8c8] dark:hover:bg-[rgba(255,255,255,0.08)]"
                    )}
                  >
                    {terminal.name} to {routeMate.name}
                  </Link>
                ))}
              </div>
            </DetailCard>
          )}

          {/* empty info guard */}
          {visibleInfoSections.length === 0 ? (
            <DetailCard>
              <div className="flex items-center gap-3 text-sm text-gray-dark dark:text-[#e0f0f4]">
                <InfoIcon className="h-5 w-5 shrink-0 text-blue-dark dark:text-[#6fb8c8]" />
                No extra WSF terminal details are currently available.
              </div>
            </DetailCard>
          ) : (
            visibleInfoSections.map((section) => renderInfoSection(section))
          )}
        </div>
      </main>
    </>
  );
};
