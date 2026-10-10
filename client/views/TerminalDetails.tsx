import clsx from "clsx";
import React, { ReactElement, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Terminal } from "shared/contracts/terminals";

import { AdSlot } from "~/components/AdSlot";
import { TerminalDropdown } from "~/components/TerminalDropdown";
import { TerminalOverview } from "~/components/TerminalOverview";
import { useFeatureFlags } from "~/lib/featureFlags";
import type { GetPath } from "~/lib/routeViews";
import { getPlainTerminalContent } from "~/lib/terminalOverview";
import { getSlug, useTerminals } from "~/lib/terminals";
import ArrowRightIcon from "~/static/images/icons/solid/arrow-right.svg";
import LocationIcon from "~/static/images/icons/solid/location.svg";
import TrophyIcon from "~/static/images/icons/solid/trophy.svg";

import { Header } from "./Header";

interface Props {
  getPath: GetPath;
  mate: Terminal | null;
  setRoute: (target: string, mate?: string) => void;
  terminal: Terminal;
}

// preserve terminal switching and sharing around the shared travel guide
export const TerminalDetails = ({
  mate,
  setRoute,
  terminal,
}: Props): ReactElement => {
  // terminal menu state
  const [isTerminalOpen, setTerminalOpen] = useState<boolean>(false);
  // wait for the existing placement readiness signal before restoring a deep link
  const [isAdReady, setAdReady] = useState(false);
  const initialHashRef = useRef<string | undefined>(undefined);
  const restoredAnchorRef = useRef<HTMLElement | null>(null);
  const { terminals, closestTerminal } = useTerminals();
  const { leaderboardsEnabled: showLeaderboardLink } = useFeatureFlags();
  // restore initial links instantly so browser anchoring can track late content above them
  useEffect(() => {
    initialHashRef.current ??= window.location.hash;
    const hash = initialHashRef.current;
    // ignore pending layouts, later navigation and unrelated fragments
    if (
      !isAdReady ||
      hash !== window.location.hash ||
      !/^#terminal-(parking|arrival|accessibility|facilities)$/.test(hash)
    ) {
      return;
    }
    const target = document.getElementById(hash.slice(1));
    // restore each mounted target once without interrupting later manual scrolling
    if (!target || restoredAnchorRef.current === target) {
      return;
    }
    restoredAnchorRef.current = target;
    target.scrollIntoView?.({ behavior: "instant", block: "start" });
  }, [isAdReady, terminal.id]);
  // normalize provider markup before sharing the static-first travel guide
  const overviewTerminal = {
    ...terminal,
    ...getPlainTerminalContent(terminal),
  };

  return (
    <>
      <Header
        share={{
          shareSurface: "terminal",
          shareButtonText: "Share Terminal",
          sharedText: `${terminal.name} Ferry Terminal details`,
        }}
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
      <main className="flex-grow overflow-y-scroll scrolling-touch bg-day-normal-light motion-safe:scroll-smooth dark:bg-night-normal-dark">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 pb-8">
          <TerminalOverview
            afterNavigation={
              <AdSlot
                arrivalTerminalId={mate?.id}
                contextLabel={`Terminal · ${terminal.name}${mate ? ` to ${mate.name}` : ""}`}
                departureTerminalId={terminal.id}
                onReadyChange={setAdReady}
                slot="terminal"
              />
            }
            mate={mate}
            terminal={overviewTerminal}
          />
          {/* leaderboard promotion follows useful travel answers */}
          {showLeaderboardLink && (
            <Link
              className={clsx(
                "group relative isolate flex items-center gap-3 overflow-hidden rounded-2xl border p-4 text-[#3d2800] shadow-[0_8px_20px_rgba(185,120,4,0.28)]",
                "border-[#b97804] bg-[linear-gradient(135deg,#fff6bb_0%,#f8d65a_26%,#d99a0a_52%,#ffe681_76%,#be7800_100%)]",
                "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-1/2 before:bg-gradient-to-br before:from-white/65 before:to-transparent",
                "transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(185,120,4,0.42)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-light"
              )}
              to={`/leaderboards/terminals/${terminal.id}`}
            >
              <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/35 shadow-sm">
                <TrophyIcon className="h-5 w-5" />
              </span>
              <span className="relative min-w-0 flex-1">
                <span className="block text-sm font-black">
                  Terminal leaderboard
                </span>
                <span className="mt-0.5 block text-xs text-[#614000]">
                  See who is leading at {terminal.name}.
                </span>
              </span>
              <span className="relative text-sm font-bold transition-transform group-hover:translate-x-0.5">
                <span className="sr-only">View leaderboard</span>
                <ArrowRightIcon aria-hidden className="h-4 w-4" />
              </span>
            </Link>
          )}
        </div>
      </main>
    </>
  );
};
