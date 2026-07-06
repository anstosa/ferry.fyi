import clsx from "clsx";
import { DateTime } from "luxon";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

import { vesselAssets } from "~/lib/generated/vesselAssets";
import { useGeo } from "~/lib/geo";
import {
  getArrivedSailing,
  getEstimatedDepartureMinutes,
  getOnboardSailing,
  getProjectedSailingProgress,
  getTrackedSailing,
  OnboardSailingMatch,
} from "~/lib/onboardSailing";
import {
  clearSimulatedVessel,
  isLocalhostSimulationEnabled,
  useSimulatedVesselId,
} from "~/lib/onboardSimulation";
import { useTrackedVessel } from "~/lib/onboardTracking";
import { getSlug, useTerminals } from "~/lib/terminals";
import { useLiveVessels } from "~/lib/vessels";
import MapMarkerIcon from "~/static/images/icons/solid/map-marker.svg";

interface Props {
  onVisibilityChange: (isVisible: boolean) => void;
}

interface ProgressTrackProps {
  departureLabel: string;
  departureSlug: string;
  destinationLabel: string;
  destinationSlug: string;
  etaMinutes: number;
  isArrived?: boolean;
  isDocked?: boolean;
  isTracking?: boolean;
  progress: number;
  vesselId: string;
  vesselName: string;
}

interface SailingNoticeProps {
  etaMinutes: number;
  isArrived: boolean;
  isDocked: boolean;
  isTracking: boolean;
  vesselName: string;
}

interface TerminalPinProps {
  align: "left" | "right";
  ariaLabel: string;
  label: string;
}

interface SailingNotificationContent {
  body: string;
  key: string;
  title: string;
  url: string;
}

type SailingNotificationType =
  | "arrived"
  | "departed"
  | "prepare-board"
  | "prepare-disembark";

type VisibleSailing = OnboardSailingMatch & {
  isArrived?: boolean;
  isDocked?: boolean;
  isTracking?: boolean;
};

const VESSEL_REFRESH_MS = 15 * 1000;
const PIN_CENTER_INSET_REM = 0.5625;
const NOTABLE_DELAY_SECONDS = 3 * 60;
const RECENT_DEPARTURE_SECONDS = 10 * 60;
const DISEMBARK_NOTICE_MINUTES = 5;

// bounded progress
const getBoundedProgress = (progress: number): number =>
  Math.max(0, Math.min(progress, 1));

// boat edge position
const getBoatLeftStyle = (progress: number, boatWidth: number): string => {
  const boundedProgress = getBoundedProgress(progress);
  const progressPercent = boundedProgress * 100;
  const pinInsetRem = PIN_CENTER_INSET_REM * (1 - 2 * boundedProgress);
  const boatOffsetPx = boatWidth * boundedProgress;
  return `calc(${progressPercent}% + ${pinInsetRem}rem - ${boatOffsetPx}px)`;
};

const CLOCK_REFRESH_MS = 1000;

// timestamp normalizer
const normalizeTimestampSeconds = (time?: number): number | null => {
  // missing timestamp guard
  if (!time) {
    return null;
  }
  // millisecond timestamp guard
  if (time > 100_000_000_000) {
    return Math.round(time / 1000);
  }
  return time;
};

// scheduled sailing timestamp
const getSailingDepartureTime = (sailing: VisibleSailing): number | null => {
  return (
    sailing.vessel.gpsDelay?.signals.scheduledDepartureTime ??
    normalizeTimestampSeconds(sailing.vessel.departedTime)
  );
};

// notification route url
const getSailingNotificationUrl = (sailing: VisibleSailing): string => {
  const departureTime = getSailingDepartureTime(sailing);
  const url = new URL(
    `/${getSlug(sailing.departureTerminal.id)}/${getSlug(
      sailing.destinationTerminal.id
    )}`,
    window.location.origin
  );
  // sailing link guard
  if (departureTime) {
    url.searchParams.set(
      "date",
      DateTime.fromSeconds(departureTime).toISODate() ?? ""
    );
    url.searchParams.set("sailing", String(departureTime));
    url.searchParams.set("tab", "sailing");
  }
  return url.toString();
};

// delay copy
const getSailingDelayDescription = (delaySeconds: number | null): string => {
  // notable delay guard
  if (delaySeconds !== null && delaySeconds > NOTABLE_DELAY_SECONDS) {
    return `${Math.round(delaySeconds / 60)} mins late`;
  }
  return "on time";
};

// boarding copy
const getBoardingInstruction = (sailing: VisibleSailing): string => {
  const walkOnTarget = sailing.departureTerminal.hasOverheadLoading
    ? "the overhead passenger loading area"
    : "the dock";
  return `Return to your vehicle. Walk-on passengers should report to ${walkOnTarget}.`;
};

// disembark copy
const getDisembarkInstruction = (sailing: VisibleSailing): string => {
  const walkOnTarget = sailing.destinationTerminal.hasOverheadLoading
    ? "the front of the passenger cabin"
    : "the front of the car deck";
  return `Return to your vehicle. Walk-on passengers should report to ${walkOnTarget}.`;
};

// local notification content
const getSailingNotificationContent = (
  sailing: VisibleSailing,
  type: SailingNotificationType
): SailingNotificationContent | null => {
  const departureTime = getSailingDepartureTime(sailing);
  const keyBase = [
    sailing.departureTerminal.id,
    sailing.destinationTerminal.id,
    departureTime ?? sailing.vessel.id,
    sailing.vessel.id,
  ].join(":");
  const url = getSailingNotificationUrl(sailing);
  // boarding notification
  if (type === "prepare-board") {
    return {
      body: `${sailing.vessel.name} has docked. ${getBoardingInstruction(
        sailing
      )}`,
      key: `${keyBase}:prepare-board`,
      title: "Prepare to board",
      url,
    };
  }
  // departure notification
  if (type === "departed") {
    const departedTime = normalizeTimestampSeconds(sailing.vessel.departedTime);
    const delaySeconds =
      departedTime && departureTime ? departedTime - departureTime : null;
    return {
      body: `${sailing.vessel.name} departed ${getSailingDelayDescription(
        delaySeconds
      )}.`,
      key: `${keyBase}:departed`,
      title: "Vessel has departed",
      url,
    };
  }
  // disembark notification
  if (type === "prepare-disembark") {
    return {
      body: `${sailing.vessel.name} is about 5 mins from ${
        sailing.destinationTerminal.name
      }. ${getDisembarkInstruction(sailing)}`,
      key: `${keyBase}:prepare-disembark`,
      title: "Prepare to disembark",
      url,
    };
  }
  return {
    body: `${sailing.vessel.name} has arrived at ${sailing.destinationTerminal.name}.`,
    key: `${keyBase}:arrived`,
    title: "Vessel has arrived",
    url,
  };
};

// local notification types
const getSailingNotificationTypes = (
  sailing: VisibleSailing,
  now: number
): SailingNotificationType[] => {
  const types: SailingNotificationType[] = [];
  const departedTime = normalizeTimestampSeconds(sailing.vessel.departedTime);
  const isRecentDeparture =
    departedTime !== null &&
    now >= departedTime &&
    now - departedTime <= RECENT_DEPARTURE_SECONDS;
  // boarding guard
  if (sailing.isTracking && sailing.isDocked) {
    types.push("prepare-board");
  }
  // departure guard
  if (!sailing.isDocked && !sailing.isArrived && isRecentDeparture) {
    types.push("departed");
  }
  // disembark guard
  if (
    !sailing.isDocked &&
    !sailing.isArrived &&
    sailing.etaMinutes <= DISEMBARK_NOTICE_MINUTES
  ) {
    types.push("prepare-disembark");
  }
  // arrival guard
  if (sailing.isArrived) {
    types.push("arrived");
  }
  return types;
};

// show local notification
const showSailingNotification = async ({
  body,
  title,
  url,
}: SailingNotificationContent): Promise<void> => {
  // notification support guard
  if (!("Notification" in window)) {
    return;
  }
  let { permission } = window.Notification;
  // permission prompt guard
  if (permission === "default") {
    permission = await window.Notification.requestPermission();
  }
  // permission guard
  if (permission !== "granted") {
    return;
  }
  const notification = new window.Notification(title, {
    badge: "/static/images/notification-badge.png",
    body,
    icon: "/static/images/icon-192x192.png",
  });
  notification.addEventListener("click", () => {
    window.focus();
    window.location.href = url;
    notification.close();
  });
};

// centered sailing status
const SailingNotice = ({
  etaMinutes,
  isArrived,
  isDocked,
  isTracking,
  vesselName,
}: SailingNoticeProps): ReactElement => {
  let noticeText = `You're sailing! ETA ${etaMinutes} mins`;
  // tracked docked copy guard
  if (isTracking && isDocked) {
    noticeText = `${vesselName} docked. Est. Departure ${etaMinutes} mins`;
  }
  // tracked copy guard
  if (isTracking && !isDocked) {
    noticeText = `Tracking ${vesselName} · ETA ${etaMinutes} mins`;
  }
  // arrived copy guard
  if (isArrived) {
    noticeText = "You've arrived!";
  }
  return (
    <div
      className={clsx(
        "truncate px-3 py-1 pr-5 text-center text-xs font-bold shadow-lg",
        "[clip-path:polygon(0_0,calc(100%-0.75rem)_0,100%_50%,calc(100%-0.75rem)_100%,0_100%)]",
        isArrived
          ? "bg-[#eafff1] text-[#008c3a] ring-1 ring-[#00c853] dark:bg-[#003f1c] dark:text-[#39ff88] dark:ring-[#39ff88]"
          : "bg-white/95 text-blue-dark ring-1 ring-white/80"
      )}
    >
      {noticeText}
    </div>
  );
};

// route endpoint pin
const TerminalPin = ({
  align,
  ariaLabel,
  label,
}: TerminalPinProps): ReactElement => (
  <div
    className={clsx(
      "absolute inset-y-0 z-20 w-10 text-white",
      align === "left" ? "left-0" : "right-0"
    )}
    aria-label={ariaLabel}
  >
    <span
      className={clsx(
        "absolute bottom-6 rounded-full bg-white/20 px-1.5 py-2",
        "text-[0.65rem] font-black uppercase leading-none tracking-[0.16em]",
        "rotate-180 shadow-sm ring-1 ring-white/40 backdrop-blur",
        align === "left" ? "left-0" : "right-0"
      )}
      style={{ writingMode: "vertical-rl" }}
    >
      {label}
    </span>
    <MapMarkerIcon
      className={clsx(
        "absolute bottom-0 text-xl drop-shadow",
        align === "left" ? "left-0" : "right-0"
      )}
    />
  </div>
);

// current vessel icon
const FerryVesselIcon = ({ vesselId }: { vesselId: string }): ReactElement => {
  const vesselAsset = vesselAssets[vesselId];
  // generated asset guard
  if (vesselAsset) {
    return (
      <img
        alt=""
        className="h-10 w-auto max-w-none object-contain drop-shadow-lg"
        src={vesselAsset.image}
      />
    );
  }
  return (
    <svg
      aria-hidden="true"
      className="h-10 w-auto drop-shadow"
      fill="none"
      viewBox="0 0 112 54"
    >
      <path
        d="M8 34h76l18-9 4 7-12 11H20L8 34Z"
        className="fill-white stroke-green-dark"
        strokeLinejoin="round"
        strokeWidth="3"
      />
      <path
        d="M22 21h54l12 13H16l6-13Z"
        className="fill-blue-lightest stroke-green-dark"
        strokeLinejoin="round"
        strokeWidth="3"
      />
    </svg>
  );
};

// sailing progress track
const ProgressTrack = ({
  departureLabel,
  departureSlug,
  destinationLabel,
  destinationSlug,
  etaMinutes,
  isArrived = false,
  isDocked = false,
  isTracking = false,
  progress,
  vesselId,
  vesselName,
}: ProgressTrackProps): ReactElement => {
  const boatRef = useRef<HTMLDivElement>(null);
  const [boatWidth, setBoatWidth] = useState(0);

  // boat width sync
  useEffect(() => {
    const boatElement = boatRef.current;
    // boat element guard
    if (!boatElement) {
      return;
    }
    // measure boat width
    const updateBoatWidth = () => {
      setBoatWidth(boatElement.getBoundingClientRect().width);
    };
    updateBoatWidth();
    const observer = new ResizeObserver(updateBoatWidth);
    observer.observe(boatElement);
    return () => observer.disconnect();
  }, [vesselId]);

  return (
    <div className="relative h-[80px] min-w-0 text-white">
      <TerminalPin
        align="left"
        ariaLabel={departureLabel}
        label={departureSlug}
      />
      <TerminalPin
        align="right"
        ariaLabel={destinationLabel}
        label={destinationSlug}
      />
      <div className="absolute bottom-[45px] left-1/2 z-30 max-w-[calc(100%-7rem)] -translate-x-1/2">
        <SailingNotice
          etaMinutes={etaMinutes}
          isArrived={isArrived}
          isDocked={isDocked}
          isTracking={isTracking}
          vesselName={vesselName}
        />
      </div>
      <div
        className={clsx(
          "absolute bottom-0 z-30",
          "transition-[left] duration-1000 ease-linear"
        )}
        ref={boatRef}
        style={{ left: getBoatLeftStyle(progress, boatWidth) }}
      >
        <FerryVesselIcon vesselId={vesselId} />
      </div>
    </div>
  );
};

// sailing banner body
const SailingCard = ({
  departureTerminal,
  destinationTerminal,
  etaMinutes,
  isArrived,
  isDocked,
  isTracking,
  progress,
  vessel,
}: VisibleSailing): ReactElement => (
  <div
    className={clsx(
      "mx-auto flex h-full w-full max-w-6xl flex-col justify-center px-4",
      "bg-blue-medium text-white shadow-lg dark:bg-blue-medium dark:text-white"
    )}
  >
    <ProgressTrack
      departureLabel={departureTerminal.name}
      departureSlug={departureTerminal.abbreviation}
      destinationLabel={destinationTerminal.name}
      destinationSlug={destinationTerminal.abbreviation}
      etaMinutes={etaMinutes}
      isArrived={isArrived}
      isDocked={isDocked}
      isTracking={isTracking}
      progress={progress}
      vesselId={vessel.id}
      vesselName={vessel.name}
    />
  </div>
);

// onboard banner container
export const OnboardSailingBanner: FunctionComponent<Props> = ({
  onVisibilityChange,
}) => {
  const [location] = useGeo();
  const { terminals } = useTerminals();
  const [now, setNow] = useState<number>(() => Date.now() / 1000);
  const [lastSailing, setLastSailing] = useState<OnboardSailingMatch | null>(
    null
  );
  const sentNotificationKeys = useRef<Set<string>>(new Set());
  const simulatedVesselId = useSimulatedVesselId();
  const [trackedVesselId] = useTrackedVessel();
  const isTrackingEnabled = Boolean(
    (location || simulatedVesselId || trackedVesselId) && terminals.length > 0
  );
  const vessels = useLiveVessels(isTrackingEnabled, VESSEL_REFRESH_MS);
  const trackedSailing = getTrackedSailing({
    terminals,
    vesselId: trackedVesselId,
    vessels,
  });
  const sailing = trackedSailing
    ? null
    : getOnboardSailing({
        simulatedVesselId,
        terminals,
        userLocation: location,
        vessels,
      });
  const activeSailing = trackedSailing ?? sailing;
  const arrivedSailing = activeSailing
    ? null
    : getArrivedSailing({
        now,
        previousSailing: lastSailing,
        vessels,
      });
  const projectedProgress =
    activeSailing && !activeSailing.vessel.isAtDock
      ? getProjectedSailingProgress(activeSailing, now)
      : (activeSailing?.progress ?? 0);
  const trackedEtaMinutes =
    trackedSailing?.vessel.isAtDock && trackedSailing
      ? getEstimatedDepartureMinutes(trackedSailing, now)
      : activeSailing?.etaMinutes;
  let visibleSailing: VisibleSailing | null = null;
  // active sailing display
  if (activeSailing) {
    visibleSailing = {
      ...activeSailing,
      etaMinutes: trackedEtaMinutes ?? activeSailing.etaMinutes,
      isDocked: activeSailing.vessel.isAtDock,
      isTracking: Boolean(trackedSailing),
      progress: projectedProgress,
    };
  }
  // arrival display fallback
  if (visibleSailing === null && arrivedSailing) {
    visibleSailing = { ...arrivedSailing, isArrived: true };
  }
  const isVisible = Boolean(visibleSailing);

  // countdown refresh
  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now() / 1000);
    }, CLOCK_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, []);

  // active sailing memory
  useEffect(() => {
    // sailing guard
    if (sailing) {
      setLastSailing(sailing);
    }
  }, [sailing]);

  // local sailing notifications
  useEffect(() => {
    // visible sailing guard
    if (!visibleSailing) {
      return;
    }
    const notificationTypes = getSailingNotificationTypes(visibleSailing, now);
    notificationTypes.forEach((type) => {
      const content = getSailingNotificationContent(visibleSailing, type);
      // content guard
      if (!content) {
        return;
      }
      // duplicate guard
      if (sentNotificationKeys.current.has(content.key)) {
        return;
      }
      sentNotificationKeys.current.add(content.key);
      showSailingNotification(content).catch((error) => {
        // notification failure
        console.warn("Failed to show sailing notification", error);
      });
    });
  }, [now, visibleSailing]);

  // header offset sync
  useEffect(() => {
    onVisibilityChange(isVisible);
    return () => onVisibilityChange(false);
  }, [isVisible, onVisibilityChange]);

  // sailing guard
  if (!visibleSailing) {
    return null;
  }

  return (
    <aside
      className={clsx(
        "fixed inset-x-0 top-0 z-30 mt-safe-top h-[80px]",
        "pl-safe-left pr-safe-right"
      )}
      aria-live="polite"
      onClick={(event) => {
        // ctrl-click guard
        if (!event.ctrlKey) {
          return;
        }
        // localhost simulation clear
        if (isLocalhostSimulationEnabled()) {
          clearSimulatedVessel();
        }
      }}
    >
      <SailingCard {...visibleSailing} />
    </aside>
  );
};
