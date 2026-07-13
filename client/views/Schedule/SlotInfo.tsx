import { useAuth0 } from "@auth0/auth0-react";
import { Browser } from "@capacitor/browser";
import { Share } from "@capacitor/share";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { DateTime } from "luxon";
import React, {
  ReactElement,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import type { Route } from "shared/contracts/routes";
import type {
  ForecastConfidence,
  ForecastFactor,
  ForecastFullRisk,
  Slot,
  SlotWeather,
} from "shared/contracts/schedules";
import type { TerminalLocation } from "shared/contracts/terminals";
import type { AlertRule } from "shared/contracts/user";
import {
  createOneTimeSailingAlertRule,
  getAlertRuleDateFromDate,
  getAlertRuleTimeFromDate,
  getRouteSubscriptionKey,
  isOneTimeSailingAlertRuleForSailing,
} from "shared/lib/alertSubscriptions";
import { isNull } from "shared/lib/identity";
import { pluralize } from "shared/lib/strings";

import { ErrorBoundary } from "~/components/ErrorBoundary";
import { ExternalPillLink } from "~/components/ExternalPillLink";
import { isDuringDaylight } from "~/lib/daylight";
import { useDevice } from "~/lib/device";
import { vesselAssets } from "~/lib/generated/vesselAssets";
import {
  isLocalhostSimulationEnabled,
  setSimulatedVessel,
} from "~/lib/onboardSimulation";
import { useTrackedVessel } from "~/lib/onboardTracking";
import { usePush } from "~/lib/push";
import type { DetailTab } from "~/lib/sailingDeepLink";
import { useUser } from "~/lib/user";
import BellIcon from "~/static/images/icons/regular/bell.svg";
import BellSolidIcon from "~/static/images/icons/solid/bell.svg";
import CarIcon from "~/static/images/icons/solid/car.svg";
import CheckCircleIcon from "~/static/images/icons/solid/check-circle.svg";
import CloudSunIcon from "~/static/images/icons/solid/cloud-sun.svg";
import ExclamationCircleIcon from "~/static/images/icons/solid/exclamation-circle.svg";
import InfoCircleIcon from "~/static/images/icons/solid/info-circle.svg";
import RaindropsIcon from "~/static/images/icons/solid/raindrops.svg";
import ShareIcon from "~/static/images/icons/solid/share-alt.svg";
import ShipIcon from "~/static/images/icons/solid/ship.svg";
import TemperatureHighIcon from "~/static/images/icons/solid/temperature-high.svg";
import ThumbsUpIcon from "~/static/images/icons/solid/thumbs-up.svg";
import TruckIcon from "~/static/images/icons/solid/truck.svg";
import UsersIcon from "~/static/images/icons/solid/users.svg";
import WindIcon from "~/static/images/icons/solid/wind.svg";

import { Capacity } from "./Capacity";
import { getCapacityDisplayPercent, isCapacityFull } from "./capacityFullness";
import {
  getCapacityFillClassName,
  getForecastCapacityFillClassName,
} from "./capacityStyles";
import { getGalleyStatus } from "./galleyHours";
import { getCurrentSlot } from "./nowDivider";
import { getProjectedTiming } from "./projectedTiming";
import {
  getScheduleRowClassName,
  getScheduleRowState,
  getScheduleSailingContext,
} from "./scheduleColors";
import { isSmallBoatCapacity } from "./smallBoat";
import { Status } from "./Status";
import { getTidalCancellationRisk } from "./tidalCancellationRisk";
import { Time } from "./Time";
import { getVesselProfileStats } from "./vesselProfile";
import { getDelayCardModel } from "./vesselStatus";
import { VesselStatus } from "./VesselStatusView";

const SMALL_BOAT_ROW_LABEL_SAFE_WIDTH = 20;

// factor display order
const FORECAST_FACTOR_ORDER = [
  "Washington school break",
  "Summer weekend",
  "Major Seattle home game",
  "Washington holiday",
  "Day before Washington holiday",
  "Washington holiday travel window",
  "Reservation-heavy route",
  "Less predictable terminal",
  "Full-boat spikes on this route",
  "Only the current WSF vehicle-space report is available.",
  "Tidal cancellation risk",
  "Busier than average pattern",
  "Sailing delayed",
  "High demand due to previous cancellation",
  "Current WSF vehicle-space report data included",
  "Current WSF vehicle-space report data not available",
  "No reported capacity data yet",
  "No tidal cancellation risk",
];

// weather factor labels
const WEATHER_FACTOR_LABELS = [
  "Good weather traffic",
  "No weather impact",
  "Bad weather traffic",
];

// weather factor guard
const isWeatherForecastFactor = (factor: ForecastFactor): boolean => {
  return WEATHER_FACTOR_LABELS.includes(factor.label);
};

// fahrenheit temperature
const getFahrenheitTemperature = (temperatureC: number): number =>
  Math.round((temperatureC * 9) / 5 + 32);

// mph wind speed
const getMphWindSpeed = (windSpeedKmh: number): number =>
  Math.round(windSpeedKmh * 0.621371);

// high temperature copy
const getHighTemperatureText = (weather: SlotWeather): string => {
  // missing high guard
  if (weather.highTemperatureC === null) {
    return "High unavailable";
  }
  return `${getFahrenheitTemperature(weather.highTemperatureC)}°F high`;
};

// cloud cover copy
const getCloudCoverText = (weather: SlotWeather): string => {
  // missing cloud guard
  if (weather.cloudCoverPercent === null) {
    return "Clouds unavailable";
  }
  const cloudCoverPercent = Math.round(weather.cloudCoverPercent);
  // clear sky guard
  if (cloudCoverPercent === 0) {
    return "Clear";
  }
  return `${cloudCoverPercent}% cover`;
};

// precipitation copy
const getPrecipitationText = (weather: SlotWeather): string => {
  // missing precipitation guard
  if (weather.precipitationMm === null) {
    return "Precip unavailable";
  }
  const precipitationInches = weather.precipitationMm / 25.4;
  // dry precipitation guard
  if (precipitationInches < 0.01) {
    return "None";
  }
  return `${precipitationInches.toFixed(2)} in`;
};

// wind copy
const getWindText = (weather: SlotWeather): string => {
  // missing wind guard
  if (weather.windSpeedKmh === null) {
    return "Wind unavailable";
  }
  const windSpeedMph = getMphWindSpeed(weather.windSpeedKmh);
  // missing gust guard
  if (weather.windGustKmh === null) {
    return `${windSpeedMph} mph wind`;
  }
  const gustSpeedMph = getMphWindSpeed(weather.windGustKmh);
  const lowWindMph = Math.min(windSpeedMph, gustSpeedMph);
  const highWindMph = Math.max(windSpeedMph, gustSpeedMph);
  // flat wind guard
  if (lowWindMph === highWindMph) {
    return `${lowWindMph} mph wind`;
  }
  return `${lowWindMph}-${highWindMph} mph wind`;
};

// sailing alert id
const getSailingAlertRuleId = ({
  routeKey,
  sailingTime,
  terminalId,
}: {
  routeKey: string;
  sailingTime: DateTime;
  terminalId: string;
}): string => {
  const date = getAlertRuleDateFromDate(sailingTime);
  const time = getAlertRuleTimeFromDate(sailingTime).replace(":", "");
  return `sailing-alert:${routeKey}:${terminalId}:${date}:${time}`;
};

// remove sailing alert
const removeSailingAlertRule = (
  rules: AlertRule[],
  {
    routeKey,
    sailingTime,
    terminalId,
  }: {
    routeKey: string;
    sailingTime: DateTime;
    terminalId: string;
  }
): AlertRule[] => {
  return rules.filter((rule) => {
    // target rule guard
    return !isOneTimeSailingAlertRuleForSailing(rule, {
      routeKey,
      sailingTime,
      terminalId,
    });
  });
};

interface Props {
  className?: string;
  getSailingShareUrl?: (tab: DetailTab) => string;
  initialDetailTab?: DetailTab;
  isExpanded: boolean;
  location: TerminalLocation;
  onClick: () => void;
  route?: Route;
  routeMaxVehicleCapacity?: number;
  schedule: Slot[];
  setElement: (element: HTMLDivElement) => void;
  slot: Slot;
  terminalId: string;
  time: DateTime;
}

export const SlotInfo = (props: Props): ReactElement => {
  const {
    className = "",
    getSailingShareUrl,
    initialDetailTab,
    isExpanded,
    location,
    onClick,
    route,
    routeMaxVehicleCapacity,
    schedule,
    setElement,
    slot,
    terminalId,
    time,
  } = props;
  const device = useDevice();
  const locationRoute = useLocation();
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0();
  const [{ alertRules, isUserLoading }, { updateUser }] = useUser();
  const initializePush = usePush(false);
  const [isSailingAlertSaving, setSailingAlertSaving] =
    useState<boolean>(false);
  const [sailingAlertError, setSailingAlertError] = useState<string | null>(
    null
  );
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>("sailing");
  const [isSailingShareCopied, setSailingShareCopied] =
    useState<boolean>(false);
  const [, setTrackedVesselId] = useTrackedVessel();
  const currentSlot = getCurrentSlot(schedule, time);
  const isNext = slot === currentSlot;
  const timing = getProjectedTiming({ schedule, slot });
  const sailingTime = DateTime.fromSeconds(slot.time);
  const sailingTerminalIds = [terminalId, slot.mateId];
  const sailingRouteKey = getRouteSubscriptionKey(sailingTerminalIds);
  const sailingAlertRule = createOneTimeSailingAlertRule({
    id: getSailingAlertRuleId({
      routeKey: sailingRouteKey,
      sailingTime,
      terminalId,
    }),
    routeKey: sailingRouteKey,
    sailingTime,
    terminalIds: [terminalId],
  });
  const isSailingAlertSubscribed = (alertRules ?? []).some((rule) => {
    // one-time sailing match
    return isOneTimeSailingAlertRuleForSailing(rule, {
      routeKey: sailingRouteKey,
      sailingTime,
      terminalId,
    });
  });
  const tidalCancellationRisk = getTidalCancellationRisk({
    departureTerminalId: terminalId,
    slot,
  });
  const isConfirmedCancelled = timing.isCancelled;
  const hasTidalCancellationRisk = Boolean(tidalCancellationRisk);
  const hasDeparted = timing.departureTime.toMillis() < time.toMillis();
  const isDaylight = isDuringDaylight(
    DateTime.fromSeconds(slot.time),
    location
  );
  const sailingContext = getScheduleSailingContext({ isDaylight });
  const liveSpacesLeft = slot.crossing
    ? slot.crossing.driveUpCapacity + slot.crossing.reservableCapacity
    : null;
  const liveCapacityTotal = slot.crossing?.totalCapacity ?? null;
  const livePercentFull =
    liveCapacityTotal && liveSpacesLeft !== null
      ? Math.min(
          ((liveCapacityTotal - liveSpacesLeft) / liveCapacityTotal) * 100,
          100
        )
      : null;
  const vesselVehicleCapacity = Math.max(
    0,
    (slot.vessel.vehicleCapacity ?? 0) - (slot.vessel.tallVehicleCapacity ?? 0)
  );
  const estimateSpacesLeft = slot.estimate
    ? slot.estimate.driveUpCapacity + (slot.estimate.reservableCapacity ?? 0)
    : null;
  const estimateCapacityTotal = liveCapacityTotal ?? vesselVehicleCapacity;
  const estimatePercentFull =
    estimateSpacesLeft !== null && estimateCapacityTotal > 0
      ? Math.min(
          ((estimateCapacityTotal - estimateSpacesLeft) /
            estimateCapacityTotal) *
            100,
          100
        )
      : null;
  const isFull = slot.crossing
    ? isCapacityFull({
        percentFull: livePercentFull,
        spacesLeft: liveSpacesLeft,
      })
    : isCapacityFull({
        percentFull: estimatePercentFull,
        spacesLeft: estimateSpacesLeft,
      });
  const timeRowState = getScheduleRowState({
    hasConfirmedCapacity: false,
    isFull,
  });
  const isHistoricalFallbackVessel = slot.vessel.id === "historical";
  // small boat status
  const isSmallBoat =
    !isHistoricalFallbackVessel &&
    isSmallBoatCapacity(slot.vessel.vehicleCapacity, routeMaxVehicleCapacity);

  const wrapper = useRef<HTMLDivElement>(null);

  // render cancellation frame
  const renderCancellationFrame = (): ReactNode => {
    // normal sailing guard
    if (!isConfirmedCancelled && !hasTidalCancellationRisk) {
      return null;
    }
    const isPastCancelled = isConfirmedCancelled && slot.hasPassed;
    return (
      <div
        aria-hidden="true"
        className={clsx(
          "pointer-events-none absolute inset-1 z-20 rounded-xl",
          "border-4 border-dotted",
          isConfirmedCancelled
            ? "border-red-dark dark:border-red-dark"
            : "border-late-light dark:border-late-dark",
          isPastCancelled && "opacity-30"
        )}
      >
        {/* cancelled stamp */}
        {isConfirmedCancelled && (
          <span
            className={clsx(
              "absolute left-1/2 top-1/2",
              "-translate-x-1/2 -translate-y-1/2 -rotate-6",
              "text-4xl font-black uppercase tracking-[0.25em]",
              "text-red-dark opacity-30 dark:text-red-dark",
              "sm:text-5xl"
            )}
          >
            CANCELLED
          </span>
        )}
      </div>
    );
  };

  // expose row element
  useEffect(() => {
    // mounted ref guard
    if (!isNull(wrapper.current)) {
      setElement(wrapper.current);
    }
  }, [wrapper]);

  // sync deep-linked tab
  useEffect(() => {
    // deep link guard
    if (!initialDetailTab) {
      return;
    }
    setActiveDetailTab(initialDetailTab);
  }, [initialDetailTab, slot.time]);

  // login redirect
  const requestLogin = async (): Promise<void> => {
    const loginOptions = {
      appState: {
        redirectPath: `${locationRoute.pathname}${locationRoute.search}`,
      },
      authorizationParams: {
        redirect_uri: process.env.AUTH0_CLIENT_REDIRECT,
      },
    };
    try {
      // native browser login
      if (device?.isNativeMobile) {
        await loginWithRedirect({
          ...loginOptions,
          openUrl: async (url) => {
            await Browser.open({ url });
          },
        });
        return;
      }
      await loginWithRedirect(loginOptions);
    } catch (error) {
      setSailingAlertError(
        error instanceof Error ? error.message : "Unable to start sign in"
      );
    }
  };

  // sailing alert toggle
  const toggleSailingAlert = async (
    event: React.MouseEvent<HTMLButtonElement>
  ): Promise<void> => {
    event.preventDefault();
    event.stopPropagation();
    setSailingAlertError(null);
    // auth guard
    if (!isAuthenticated) {
      await requestLogin();
      return;
    }
    // loading guard
    if (isLoading || isUserLoading || isSailingAlertSaving) {
      return;
    }
    setSailingAlertSaving(true);
    const currentAlertRules = alertRules ?? [];
    const nextAlertRules = isSailingAlertSubscribed
      ? removeSailingAlertRule(currentAlertRules, {
          routeKey: sailingRouteKey,
          sailingTime,
          terminalId,
        })
      : [...currentAlertRules, sailingAlertRule];
    try {
      await updateUser({
        app_metadata: {
          alertRules: nextAlertRules,
        },
      });
      // push permission guard
      if (!isSailingAlertSubscribed) {
        initializePush();
      }
    } catch (error) {
      setSailingAlertError(
        error instanceof Error ? error.message : "Unable to save alert"
      );
    } finally {
      setSailingAlertSaving(false);
    }
  };

  // copy sailing share link
  const copySailingShareUrl = async (url: string): Promise<boolean> => {
    // clipboard support guard
    if (!navigator.clipboard) {
      return false;
    }
    await navigator.clipboard.writeText(url);
    setSailingShareCopied(true);
    setTimeout(() => {
      setSailingShareCopied(false);
    }, 2500);
    return true;
  };

  // share sailing tab
  const shareSailingTab = async (
    event: React.MouseEvent<HTMLButtonElement>
  ): Promise<void> => {
    event.preventDefault();
    event.stopPropagation();
    const url = getSailingShareUrl?.(activeDetailTab) ?? window.location.href;
    const title = `Ferry FYI sailing ${sailingTime.toFormat(
      "ccc, LLL d · h:mm a"
    )}`;
    try {
      const { value: canShare } = await Share.canShare();
      // native share guard
      if (canShare) {
        await Share.share({
          dialogTitle: title,
          text: title,
          title: "Ferry FYI",
          url,
        });
        return;
      }
      await copySailingShareUrl(url);
    } catch (error) {
      console.error("Failed to share sailing", error);
      await copySailingShareUrl(url);
    }
  };

  const renderHeader = (): ReactNode => (
    <section
      className={clsx(
        // align full stripes
        "relative isolate p-3 h-[84.85px]",
        "flex justify-between",
        "cursor-pointer transition",
        "hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-green-light dark:hover:bg-white/10"
      )}
      ref={wrapper}
      onClick={onClick}
      onKeyDown={(event) => {
        // keyboard activation
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      role="button"
      aria-label={`${time.toLocaleString(DateTime.DATETIME_SHORT)} sailing`}
      aria-expanded={isExpanded}
      tabIndex={0}
    >
      {/* cancellation frame */}
      {renderCancellationFrame()}
      <Capacity
        hasDeparted={hasDeparted}
        isDaylight={isDaylight}
        leftReservedWidth={isSmallBoat ? SMALL_BOAT_ROW_LABEL_SAFE_WIDTH : 0}
        slot={slot}
      />
      {/* small boat guard */}
      {isSmallBoat && (
        <span
          className={clsx(
            "pointer-events-none absolute -left-px top-1/2 z-10",
            "flex -translate-y-1/2 flex-col items-center justify-center",
            "min-h-[4.5rem] w-5 rounded-r",
            "bg-red-dark text-white dark:bg-red-dark dark:text-white",
            "text-[9px] font-bold leading-none tracking-wide shadow-sm"
          )}
          aria-label="Small boat"
        >
          <ShipIcon className="mb-1 h-3 w-3 shrink-0" />
          <span className="rotate-180 [writing-mode:vertical-rl]">SMALL</span>
        </span>
      )}
      <div className="flex flex-col justify-between items-start z-0">
        <div className="flex-grow" />
        <Status className="" time={time} timing={timing} />
      </div>
      <Time
        context={sailingContext}
        isExpanded={isExpanded}
        isNext={isNext}
        rowState={timeRowState}
        time={time}
        timing={timing}
      />
    </section>
  );

  // render profile stat
  const renderProfileStat = (
    label: string,
    value: ReactNode,
    Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  ): ReactNode => (
    <div
      className={clsx(
        "rounded-lg border",
        "border-darken-low dark:border-lighten-low",
        "bg-white/70 dark:bg-black/20",
        "p-3"
      )}
    >
      <div className="mb-1 flex items-center text-2xs uppercase tracking-wide text-gray-dark dark:text-gray-light">
        <Icon className="mr-1.5" />
        {label}
      </div>
      <div className="text-base font-bold leading-tight">{value}</div>
    </div>
  );

  // render delay card
  const renderDelayCard = (
    delayCard: ReturnType<typeof getDelayCardModel>
  ): ReactNode => {
    const isOrange = delayCard.isLate;
    const StatusIcon = isOrange ? ExclamationCircleIcon : CheckCircleIcon;
    return (
      <section
        className={clsx(
          "col-span-2 rounded-lg border p-3",
          isOrange
            ? [
                "border-late-light bg-[#fff3e8] text-late-light",
                "dark:border-late-dark dark:bg-late-dark/20 dark:text-late-dark",
              ]
            : [
                "border-blue-medium bg-blue-lightest text-blue-dark",
                "dark:border-blue-light dark:bg-blue-dark/30 dark:text-blue-light",
              ]
        )}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-base font-bold leading-tight">
            <StatusIcon className="h-5 w-5 shrink-0" />
            <span>{delayCard.title}</span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            {delayCard.signals.map(({ label, value }) => {
              // delay signal row
              return (
                <div
                  className="rounded bg-white/70 p-2 text-gray-darkest dark:bg-black/20 dark:text-white"
                  key={label}
                >
                  <dt className="font-semibold uppercase tracking-wide text-gray-dark dark:text-gray-light">
                    {label}
                  </dt>
                  <dd
                    className={clsx(
                      "mt-1 font-bold",
                      value === "Unavailable" &&
                        "text-gray-medium dark:text-gray-medium"
                    )}
                  >
                    {value}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </section>
    );
  };

  // render capacity card
  const renderCapacityCard = ({
    className,
    isForecast,
    onClick,
    showRisk = true,
    percentFull,
    spacesLeft,
  }: {
    className?: string;
    isForecast?: boolean;
    onClick?: () => void;
    showRisk?: boolean;
    percentFull: number | null;
    spacesLeft: number | null;
  }): ReactNode => {
    const isUnavailable = percentFull === null || spacesLeft === null;
    const isFullCapacity = isCapacityFull({ percentFull, spacesLeft });
    const displayPercent = getCapacityDisplayPercent({
      isFull: isFullCapacity,
      percentFull,
    });
    const confirmedBorderClassName = isDaylight
      ? "border-day-confirmed-light dark:border-day-confirmed-dark"
      : "border-night-confirmed-light dark:border-night-confirmed-dark";
    const confirmedFillClassName = isDaylight
      ? "bg-day-normal-light dark:bg-day-normal-dark"
      : "bg-night-normal-light dark:bg-night-normal-dark";
    let fillClassName: string | string[] = confirmedFillClassName;
    // forecast fill
    if (isForecast) {
      fillClassName = getForecastCapacityFillClassName({
        isFull: isFullCapacity,
      });
    } else if (isFullCapacity) {
      fillClassName = getCapacityFillClassName({ isDaylight, isFull: true });
    }
    let headline = "Unavailable";
    let detail = isForecast ? "No forecast yet" : "No confirmed count yet";
    // available capacity copy
    if (!isUnavailable) {
      headline = `${Math.round(percentFull)}% full`;
      detail = isFullCapacity
        ? "Boat full"
        : `${pluralize(spacesLeft, "space")} left`;
    }
    let riskText: string | null = null;
    // risk card copy
    if (showRisk && isForecast && slot.estimate?.fullRisk === "high") {
      const riskPercent = slot.estimate.fullProbability
        ? ` · ${Math.round(slot.estimate.fullProbability * 100)}% risk`
        : "";
      riskText = `High full risk${riskPercent}`;
    } else if (showRisk && isForecast && slot.estimate?.fullRisk === "likely") {
      const riskPercent = slot.estimate.fullProbability
        ? ` · ${Math.round(slot.estimate.fullProbability * 100)}% risk`
        : "";
      riskText = `Likely full${riskPercent}`;
    } else if (
      showRisk &&
      isForecast &&
      slot.estimate?.fullRisk === "unlikely"
    ) {
      const riskPercent = slot.estimate.fullProbability
        ? ` · ${Math.round(slot.estimate.fullProbability * 100)}% risk`
        : "";
      riskText = `Unlikely full${riskPercent}`;
    }
    return (
      <section
        className={clsx(
          "relative overflow-hidden rounded-lg border p-3",
          onClick &&
            "cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md",
          className,
          isUnavailable
            ? [
                "border-gray-medium bg-white text-gray-dark",
                "dark:border-gray-dark dark:bg-black/20 dark:text-gray-light",
              ]
            : [
                "bg-white text-gray-darkest dark:bg-black/20 dark:text-white",
                isForecast
                  ? "border-2 border-dashed border-gray-medium dark:border-gray-medium"
                  : ["border-2", confirmedBorderClassName],
              ]
        )}
        onClick={onClick}
        onKeyDown={(event) => {
          // keyboard activation
          if (!onClick || (event.key !== "Enter" && event.key !== " ")) {
            return;
          }
          event.preventDefault();
          onClick();
        }}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        {/* capacity fill */}
        {!isUnavailable && (
          <div
            aria-hidden="true"
            className={clsx("absolute inset-y-0 left-0", fillClassName)}
            style={{ width: `${displayPercent}%` }}
          />
        )}
        <div className="relative">
          <p className="text-2xs font-bold uppercase tracking-wide opacity-80">
            {isForecast ? "Forecast capacity" : "Confirmed capacity"}
          </p>
          <p className="mt-1 text-xl font-black leading-tight">{headline}</p>
          <p className="mt-1 text-xs font-semibold opacity-90">{detail}</p>
          {/* forecast risk */}
          {riskText && (
            <p className="mt-1 text-xs font-bold uppercase tracking-wide text-gray-dark dark:text-gray-light">
              {riskText}
            </p>
          )}
        </div>
      </section>
    );
  };

  // render sailing alert button
  const renderSailingAlertButton = (): ReactNode => {
    const AlertIcon = isSailingAlertSubscribed ? BellSolidIcon : BellIcon;
    const alertLabel = isSailingAlertSubscribed
      ? "Turn off this sailing alert"
      : "Add this sailing alert";
    return (
      <button
        aria-label={alertLabel}
        aria-pressed={isSailingAlertSubscribed}
        className={clsx(
          "absolute right-3 top-3 rounded-full border p-2 shadow-sm transition",
          isSailingAlertSubscribed
            ? [
                "border-green-dark bg-green-dark text-white",
                "dark:border-green-light dark:bg-green-light dark:text-green-dark",
              ]
            : [
                "border-blue-medium bg-white text-blue-dark hover:bg-blue-lightest",
                "dark:border-blue-light dark:bg-black/30 dark:text-blue-light",
              ],
          (isLoading || isSailingAlertSaving || isUserLoading) &&
            "cursor-wait opacity-70"
        )}
        disabled={isLoading || isSailingAlertSaving || isUserLoading}
        onClick={toggleSailingAlert}
        title={alertLabel}
        type="button"
      >
        <AlertIcon
          className={clsx("h-5 w-5", isSailingAlertSaving && "animate-pulse")}
        />
      </button>
    );
  };

  // render sailing card
  const renderSailingCard = (
    delayCard: ReturnType<typeof getDelayCardModel>
  ): ReactNode => {
    const sailingTimeLabel = sailingTime.toFormat("ccc, LLL d · h:mm a");
    // confirmed capacity visibility
    const shouldShowConfirmedCapacityCard =
      livePercentFull !== null && livePercentFull > 0;
    // forecast capacity visibility
    const shouldShowForecastCapacityCard = !isHistoricalFallbackVessel;
    // single capacity layout
    const shouldUseFullWidthCapacityCard =
      shouldShowConfirmedCapacityCard !== shouldShowForecastCapacityCard;
    const capacityCardClassName = shouldUseFullWidthCapacityCard
      ? "col-span-2"
      : undefined;
    return (
      <article
        className={clsx(
          "relative mb-3 overflow-hidden rounded-xl border",
          "border-gray-medium bg-white text-black shadow-sm",
          "dark:border-gray-dark dark:bg-gray-darkest dark:text-white"
        )}
      >
        {renderSailingAlertButton()}
        <header
          className={clsx(
            "p-4 pr-16",
            "bg-gradient-to-br from-green-lightest via-white to-blue-lightest",
            "dark:from-green-dark dark:via-gray-darkest dark:to-blue-darkest"
          )}
        >
          <p className="text-2xs font-bold uppercase tracking-wide text-gray-dark dark:text-gray-light">
            Sailing
          </p>
          <h3 className="mt-1 text-2xl font-bold leading-tight">
            {sailingTimeLabel}
          </h3>
          {/* sailing alert explanation */}
          {isSailingAlertSubscribed && (
            <p className="mt-1 text-sm text-gray-dark dark:text-gray-light">
              One-time alerts cover delays, cancellations, and tidal
              cancellation risk for this departure only.
            </p>
          )}
          {/* sailing alert error */}
          {sailingAlertError && (
            <p className="mt-2 rounded bg-red-light p-2 text-xs font-semibold text-red-dark dark:bg-red-dark dark:text-white">
              {sailingAlertError}
            </p>
          )}
        </header>
        <div className="grid grid-cols-2 gap-3 p-4">
          {/* tidal risk card */}
          {renderTidalRiskCard()}
          {/* timing card */}
          {!isConfirmedCancelled && renderDelayCard(delayCard)}
          {/* non-empty confirmed capacity */}
          {shouldShowConfirmedCapacityCard &&
            renderCapacityCard({
              className: capacityCardClassName,
              percentFull: livePercentFull,
              spacesLeft: liveSpacesLeft,
            })}
          {/* non-historical forecast capacity */}
          {shouldShowForecastCapacityCard &&
            renderCapacityCard({
              className: capacityCardClassName,
              isForecast: true,
              onClick: () => {
                // open forecast tab
                setActiveDetailTab("forecast");
              },
              percentFull: estimatePercentFull,
              showRisk: false,
              spacesLeft: estimateSpacesLeft,
            })}
        </div>
      </article>
    );
  };

  // factor tone class
  const getForecastFactorClassName = (impact: ForecastFactor["impact"]) => {
    // higher demand tone
    if (impact === "higher") {
      return [
        "border-late-light bg-[#fff3e8] text-late-light",
        "dark:border-late-dark dark:bg-late-dark/20 dark:text-late-dark",
      ];
    }
    // lower demand tone
    if (impact === "lower") {
      return [
        "border-blue-medium bg-blue-lightest text-blue-dark",
        "dark:border-blue-light dark:bg-blue-dark/30 dark:text-blue-light",
      ];
    }
    return [
      "border-gray-medium bg-white text-gray-darkest",
      "dark:border-gray-dark dark:bg-black/20 dark:text-white",
    ];
  };

  // factor icon shell
  const getForecastFactorIconClassName = (
    impact: ForecastFactor["impact"]
  ): string[] => {
    // higher demand icon
    if (impact === "higher") {
      return ["bg-[#fff3e8] text-late-light", "dark:bg-late-dark/20"];
    }
    // lower demand icon
    if (impact === "lower") {
      return ["bg-green-dark/10 text-green-dark", "dark:text-green-light"];
    }
    return ["bg-gray-light text-gray-dark", "dark:bg-white/10 dark:text-white"];
  };

  // factor icon
  const renderForecastFactorIcon = (
    impact: ForecastFactor["impact"]
  ): ReactNode => {
    const className = "h-4 w-4";
    // higher demand icon
    if (impact === "higher") {
      return <ExclamationCircleIcon className={className} />;
    }
    // lower demand icon
    if (impact === "lower") {
      return <ThumbsUpIcon className={className} />;
    }
    return <InfoCircleIcon className={className} />;
  };

  // factor list text
  const getForecastFactorText = (factor: ForecastFactor): string => {
    // detail guard
    if (!factor.detail) {
      return factor.label;
    }
    return `${factor.label} (${factor.detail})`;
  };

  // factor sort order
  const getForecastFactorOrder = (factor: ForecastFactor): number => {
    const order = FORECAST_FACTOR_ORDER.indexOf(factor.label);
    // unknown factor guard
    if (order === -1) {
      return FORECAST_FACTOR_ORDER.length;
    }
    return order;
  };

  // confidence tone class
  const getForecastConfidenceClassName = (
    confidence: ForecastConfidence
  ): string[] => {
    // high confidence tone
    if (confidence === "high") {
      return [
        "border-green-dark bg-green-dark/10 text-green-dark",
        "dark:border-green-light dark:bg-green-light/10 dark:text-green-light",
      ];
    }
    // medium confidence tone
    if (confidence === "medium") {
      return [
        "border-yellow-dark bg-yellow-lightest text-yellow-darkest",
        "dark:border-yellow-medium dark:bg-yellow-dark/30 dark:text-yellow-lightest",
      ];
    }
    return [
      "border-red-dark bg-red-light text-red-dark",
      "dark:border-red-light dark:bg-red-dark/30 dark:text-red-light",
    ];
  };

  // risk tone class
  const getForecastRiskClassName = (fullRisk: ForecastFullRisk): string[] => {
    // low risk tone
    if (fullRisk === "low") {
      return [
        "border-green-dark bg-green-dark/10 text-green-dark",
        "dark:border-green-light dark:bg-green-light/10 dark:text-green-light",
      ];
    }
    // unlikely risk tone
    if (fullRisk === "unlikely") {
      return [
        "border-gray-medium bg-white text-gray-darkest",
        "dark:border-gray-dark dark:bg-black/20 dark:text-white",
      ];
    }
    // likely risk tone
    if (fullRisk === "likely") {
      return [
        "border-late-light bg-[#fff3e8] text-late-light",
        "dark:border-late-dark dark:bg-late-dark/20 dark:text-late-dark",
      ];
    }
    return [
      "border-red-dark bg-red-light text-red-dark",
      "dark:border-red-light dark:bg-red-dark/30 dark:text-red-light",
    ];
  };

  // weather effect line class
  const getWeatherEffectLineClassName = (
    factor: ForecastFactor | undefined
  ): string[] => {
    // busier weather tone
    if (factor?.impact === "higher") {
      return [
        "border-late-light bg-[#fff3e8] text-late-light",
        "dark:border-late-dark dark:bg-late-dark/20 dark:text-late-dark",
      ];
    }
    // less busy weather tone
    if (factor?.impact === "lower") {
      return [
        "border-green-dark bg-green-dark/10 text-green-dark",
        "dark:border-green-light dark:bg-green-light/10 dark:text-green-light",
      ];
    }
    return [
      "border-gray-medium bg-gray-light text-gray-darkest",
      "dark:border-gray-dark dark:bg-white/10 dark:text-white",
    ];
  };

  // weather effect copy
  const getWeatherEffectText = (factor: ForecastFactor | undefined): string => {
    // busier weather copy
    if (factor?.impact === "higher") {
      return "Busier from weather";
    }
    // less busy weather copy
    if (factor?.impact === "lower") {
      return "Less busy from weather";
    }
    return "No weather effect";
  };

  // render weather forecast card
  const renderWeatherForecastCard = (
    factor: ForecastFactor | undefined
  ): ReactNode => {
    const { weather } = slot;
    // missing weather guard
    if (!weather) {
      return null;
    }
    const items = [
      {
        icon: <TemperatureHighIcon className="h-4 w-4" />,
        label: "Temperature",
        value: getHighTemperatureText(weather),
      },
      {
        icon: <CloudSunIcon className="h-4 w-4" />,
        label: "Clouds",
        value: getCloudCoverText(weather),
      },
      {
        icon: <RaindropsIcon className="h-4 w-4" />,
        label: "Precipitation",
        value: getPrecipitationText(weather),
      },
      {
        icon: <WindIcon className="h-4 w-4" />,
        label: "Wind",
        value: getWindText(weather),
      },
    ];
    return (
      <section
        className={clsx(
          "overflow-hidden rounded-lg border",
          "border-gray-medium bg-white text-gray-darkest",
          "dark:border-gray-dark dark:bg-black/20 dark:text-white"
        )}
      >
        <div className="p-3">
          <p className="text-xs font-bold uppercase tracking-wide">
            Weather forecast
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {items.map((item) => {
              // weather detail item
              return (
                <div className="flex items-center gap-2" key={item.label}>
                  <span
                    className={clsx(
                      "flex h-7 w-7 shrink-0 items-center justify-center",
                      "rounded-full bg-blue-lightest text-blue-dark shadow-sm",
                      "dark:bg-blue-dark/30 dark:text-blue-light"
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-2xs font-bold uppercase tracking-wide text-gray-dark dark:text-gray-light">
                      {item.label}
                    </span>
                    <span className="block text-sm font-semibold leading-snug">
                      {item.value}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <p
          className={clsx(
            "border-t px-3 py-2 text-xs font-bold uppercase tracking-wide",
            getWeatherEffectLineClassName(factor)
          )}
        >
          {getWeatherEffectText(factor)}
        </p>
      </section>
    );
  };

  // source copy
  const getForecastSourceText = (): string => {
    // source guard
    if (slot.estimate?.source === "live") {
      return "Current WSF report";
    }
    // source guard
    if (slot.estimate?.source === "blended") {
      return "WSF report + Ferry FYI history";
    }
    // source guard
    if (slot.estimate?.source === "historical") {
      return "Ferry FYI history";
    }
    // source guard
    if (slot.estimate?.source === "disruption") {
      return "Disruption-adjusted";
    }
    return "Unavailable";
  };

  // render forecast card
  const renderForecastCard = (): ReactNode => {
    const factors = slot.estimate?.factors ?? [];
    const historicalPatternFactor = factors.find((factor) => {
      // historical factor match
      return factor.label === "Historical pattern";
    });
    const weatherForecastFactor = factors.find((factor) => {
      // weather factor match
      return isWeatherForecastFactor(factor);
    });
    const forecastListFactors = factors
      .filter((factor) => {
        // card factor exclusion
        return (
          factor.label !== "Historical pattern" &&
          !isWeatherForecastFactor(factor)
        );
      })
      .sort((left, right) => {
        // configured order sort
        return getForecastFactorOrder(left) - getForecastFactorOrder(right);
      });
    const confidence = slot.estimate?.confidence ?? "low";
    const riskPercent = slot.estimate?.fullProbability
      ? Math.round(slot.estimate.fullProbability * 100)
      : 0;
    const fullRisk = slot.estimate?.fullRisk ?? "low";
    return (
      <article
        className={clsx(
          "overflow-hidden rounded-xl border",
          "border-gray-medium bg-white text-black shadow-sm",
          "dark:border-gray-dark dark:bg-gray-darkest dark:text-white"
        )}
      >
        <header
          className={clsx(
            "relative overflow-hidden p-4",
            "bg-gradient-to-br from-blue-lightest via-white to-green-lightest",
            "dark:from-blue-darkest dark:via-gray-darkest dark:to-green-dark"
          )}
        >
          <p className="text-2xs font-bold uppercase tracking-wide text-gray-dark dark:text-gray-light">
            Forecast
          </p>
          <h3 className="mt-1 text-2xl font-bold leading-tight">
            {getForecastSourceText()}
          </h3>
          {/* confidence pill */}
          <div className="mt-4 flex">
            <span
              className={clsx(
                "inline-flex rounded-full border px-3 py-1",
                "text-xs font-black uppercase tracking-wide",
                getForecastConfidenceClassName(confidence)
              )}
            >
              Confidence: {confidence}
            </span>
          </div>
        </header>
        <div className="grid gap-3 p-4">
          <div className="grid grid-cols-2 gap-2">
            {/* forecast capacity card */}
            {renderCapacityCard({
              isForecast: true,
              percentFull: estimatePercentFull,
              showRisk: false,
              spacesLeft: estimateSpacesLeft,
            })}
            <section
              className={clsx(
                "rounded-lg border p-3",
                getForecastRiskClassName(fullRisk)
              )}
            >
              <p className="text-2xs font-bold uppercase tracking-wide opacity-80">
                Full Sailing Risk
              </p>
              <p className="mt-1 text-xl font-black uppercase leading-tight">
                {fullRisk}
              </p>
              <p className="mt-1 text-xs font-semibold opacity-80">
                {riskPercent}% likelihood
              </p>
            </section>
          </div>
          {/* no factors guard */}
          {factors.length === 0 && (
            <div
              className={clsx(
                "rounded-lg border p-3",
                "border-gray-medium bg-white text-gray-darkest",
                "dark:border-gray-dark dark:bg-black/20 dark:text-white"
              )}
            >
              <p className="text-sm font-semibold">
                No forecast factors are available yet for this sailing.
              </p>
            </div>
          )}
          {/* weather forecast card */}
          {renderWeatherForecastCard(weatherForecastFactor)}
          {/* historical pattern card */}
          {historicalPatternFactor && (
            <section
              className={clsx(
                "rounded-lg border p-3",
                getForecastFactorClassName(historicalPatternFactor.impact)
              )}
            >
              <p className="text-xs font-bold uppercase tracking-wide">
                {historicalPatternFactor.label}
              </p>
              <p className="mt-1 text-sm font-semibold leading-snug text-gray-darkest dark:text-white">
                {historicalPatternFactor.detail}
              </p>
            </section>
          )}
          {/* forecast signal list */}
          {forecastListFactors.length > 0 && (
            <ul className="grid gap-2">
              {forecastListFactors.map((factor) => {
                // factor list item
                return (
                  <li
                    className="flex min-h-7 items-center gap-2 text-gray-darkest dark:text-white"
                    key={`${factor.label}:${factor.detail}`}
                  >
                    <span
                      className={clsx(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-sm",
                        getForecastFactorIconClassName(factor.impact)
                      )}
                    >
                      {renderForecastFactorIcon(factor.impact)}
                    </span>
                    <span className="flex min-h-7 min-w-0 flex-1 items-center">
                      <span className="text-sm font-semibold leading-snug">
                        {getForecastFactorText(factor)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </article>
    );
  };

  // render tab shell
  const renderTabbedDetails = ({
    forecastCard,
    sailingCard,
    vesselCard,
  }: {
    forecastCard: ReactNode;
    sailingCard: ReactNode;
    vesselCard: ReactNode;
  }): ReactNode => {
    const tabs: Array<{ id: DetailTab; label: string; panel: ReactNode }> = [
      { id: "sailing", label: "Sailing", panel: sailingCard },
      { id: "forecast", label: "Forecast", panel: forecastCard },
      { id: "vessel", label: "Vessel", panel: vesselCard },
    ];
    const activePanel = tabs.find((tab) => {
      // active tab match
      return tab.id === activeDetailTab;
    })?.panel;
    return (
      <div
        className={clsx(
          "p-3 sm:p-4",
          "text-sm",
          "shadow-inset bg-darken-lowest",
          className
        )}
      >
        <div className="mb-3 flex items-stretch gap-2">
          <div
            aria-label="Sailing details"
            className="grid flex-1 grid-cols-3 rounded-xl bg-black/10 p-1 dark:bg-white/10"
            role="tablist"
          >
            {tabs.map((tab) => {
              // tab button
              return (
                <button
                  aria-selected={activeDetailTab === tab.id}
                  className={clsx(
                    "rounded-lg px-2 py-2 text-xs font-black uppercase tracking-wide",
                    "transition focus-visible:outline-none focus-visible:ring-2",
                    "focus-visible:ring-green-light",
                    activeDetailTab === tab.id
                      ? "bg-white text-green-dark shadow-sm dark:bg-gray-darkest dark:text-green-light"
                      : "text-gray-dark hover:bg-white/40 dark:text-gray-light dark:hover:bg-white/10"
                  )}
                  key={tab.id}
                  onClick={() => {
                    // select tab
                    setActiveDetailTab(tab.id);
                  }}
                  role="tab"
                  type="button"
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <button
            aria-label={
              isSailingShareCopied
                ? "Copied sailing link"
                : "Share this sailing tab"
            }
            className={clsx(
              "flex w-11 shrink-0 items-center justify-center rounded-xl",
              "border border-black/10 bg-black/10 text-gray-dark",
              "transition hover:bg-white/40 focus-visible:outline-none focus-visible:ring-2",
              "focus-visible:ring-green-light dark:border-white/10 dark:bg-white/10 dark:text-gray-light",
              "dark:hover:bg-white/20"
            )}
            onClick={shareSailingTab}
            title={
              isSailingShareCopied
                ? "Copied sailing link"
                : "Share this sailing tab"
            }
            type="button"
          >
            <ShareIcon className="h-4 w-4" />
          </button>
        </div>
        <div role="tabpanel">{activePanel}</div>
      </div>
    );
  };

  // render tidal risk card
  const renderTidalRiskCard = (): ReactNode => {
    // risk availability guard
    if (!tidalCancellationRisk) {
      return null;
    }
    // confirmed cancellation tone
    const isConfirmedCancellationCard = isConfirmedCancelled;
    return (
      <section
        className={clsx(
          "col-span-2 rounded-lg border p-3",
          isConfirmedCancellationCard
            ? [
                "border-red-dark bg-red-light text-red-dark",
                "dark:border-red-dark dark:bg-red-dark dark:text-white",
              ]
            : [
                "border-late-light bg-[#fff3e8] text-late-light",
                "dark:border-late-dark dark:bg-late-dark/20 dark:text-late-dark",
              ]
        )}
      >
        <div className="flex items-start gap-2">
          <ExclamationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="text-base font-bold leading-tight">
              {tidalCancellationRisk.title}
            </div>
            <p
              className={clsx(
                "mt-2 text-xs leading-snug",
                isConfirmedCancellationCard
                  ? "text-red-dark dark:text-white"
                  : "text-gray-darkest dark:text-white"
              )}
            >
              {tidalCancellationRisk.explanation}
            </p>
          </div>
        </div>
      </section>
    );
  };

  // render details card
  const renderDetails = (): ReactNode => {
    const { vessel } = slot;
    const { classId, hasGalley, hasWiFi, name } = vessel;
    const vesselAsset = vesselAssets[vessel.id];
    const {
      passengerCapacityLabel,
      regularVehicleCapacity,
      tallVehicleCapacity,
      vehicleCapacity,
      vesselClassLabel,
    } = getVesselProfileStats(vessel, vesselAsset?.className ?? classId);
    const delayCard = getDelayCardModel({
      delayMins: timing.delayMins,
      slot,
    });
    // historical fallback card
    if (isHistoricalFallbackVessel) {
      const vesselCard = (
        <article
          className={clsx(
            "overflow-hidden rounded-xl border",
            "border-gray-medium dark:border-gray-dark",
            "bg-white text-black shadow-sm",
            "dark:bg-gray-darkest dark:text-white"
          )}
        >
          <header
            className={clsx(
              "relative overflow-hidden p-4",
              "bg-gradient-to-br from-blue-lightest via-white to-yellow-lightest",
              "dark:from-blue-darkest dark:via-gray-darkest dark:to-yellow-dark"
            )}
          >
            <p className="text-2xs font-bold uppercase tracking-wide text-gray-dark dark:text-gray-light">
              Vessel
            </p>
            <h3 className="mt-1 text-2xl font-bold leading-tight">
              Unknown vessel
            </h3>
          </header>
        </article>
      );
      return renderTabbedDetails({
        forecastCard: renderForecastCard(),
        sailingCard: renderSailingCard(delayCard),
        vesselCard,
      });
    }
    const galleyStatus = getGalleyStatus({
      currentTime: time,
      route,
      sailingTime: DateTime.fromSeconds(slot.time),
      schedule,
      slot,
    });
    const galleyChipStatus =
      hasGalley && galleyStatus === "open" ? "open" : "closed";
    const galleyChipLabel = hasGalley
      ? `Galley ${galleyChipStatus.toUpperCase()}`
      : "NO Galley";
    const amenityChips: Array<{
      label: string;
      status: typeof galleyStatus;
    }> = [
      {
        label: galleyChipLabel,
        status: galleyChipStatus,
      },
      {
        label: hasWiFi ? "Wi-Fi ON" : "Wi-Fi OFF",
        status: hasWiFi ? "open" : "closed",
      },
    ];
    const isVesselSailingNow = !vessel.isAtDock;
    const hasTrackableRouteContext = Boolean(
      vessel.arrivingTerminalId && vessel.departingTerminalId
    );
    const hasTrackableLiveSignal = Boolean(vessel.gpsDelay || vessel.location);
    const canTrackBoat = Boolean(
      (isNext || isVesselSailingNow) &&
      hasTrackableRouteContext &&
      hasTrackableLiveSignal
    );
    // track boat action
    const trackBoat = (event: React.MouseEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      setTrackedVesselId(vessel.id);
    };
    const vesselCard = (
      <article
        className={clsx(
          "overflow-hidden rounded-xl border",
          "border-gray-medium dark:border-gray-dark",
          "bg-white text-black shadow-sm",
          "dark:bg-gray-darkest dark:text-white"
        )}
      >
        <header
          className={clsx(
            "relative overflow-hidden p-4",
            "bg-gradient-to-br from-blue-lightest via-white to-yellow-lightest",
            "dark:from-blue-darkest dark:via-gray-darkest dark:to-yellow-dark"
          )}
        >
          {/* vessel image guard */}
          {vesselAsset && (
            <img
              alt=""
              className={clsx(
                "pointer-events-none absolute bottom-0 right-0 max-w-none translate-x-1/2",
                "max-h-[110%] w-full select-none object-contain object-left-bottom"
              )}
              src={vesselAsset.image}
            />
          )}
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div className="max-w-[70%]">
                {/* small boat guard */}
                {isSmallBoat && (
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={clsx(
                        "rounded px-2 py-1",
                        "bg-red-dark text-white dark:bg-red-dark dark:text-white",
                        "whitespace-nowrap text-2xs font-bold uppercase tracking-wide"
                      )}
                    >
                      <ShipIcon className="mr-1 inline-block" />
                      SMALL
                    </span>
                  </div>
                )}
                <p className="text-2xs font-bold uppercase tracking-wide text-gray-dark dark:text-gray-light">
                  Vessel
                </p>
                <h3
                  className="mt-1 text-2xl font-bold leading-tight"
                  onClick={(event) => {
                    // ctrl-click guard
                    if (!event.ctrlKey) {
                      return;
                    }
                    // localhost simulation guard
                    if (!isLocalhostSimulationEnabled()) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    setSimulatedVessel(vessel.id);
                  }}
                >
                  {name}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <ErrorBoundary
                    className="m-0"
                    fallbackTitle="Vessel status crashed"
                    fallbackMessage="Live vessel status is unavailable for this sailing."
                  >
                    {/* live vessel status */}
                    <VesselStatus
                      className="block items-start text-left font-medium text-gray-dark dark:text-gray-light"
                      vessel={vessel}
                      time={time}
                    />
                  </ErrorBoundary>
                  {/* track boat guard */}
                  {canTrackBoat && (
                    <button
                      className="link text-sm font-bold text-blue-dark dark:text-blue-light"
                      type="button"
                      onClick={trackBoat}
                    >
                      Track Boat
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-3 flex w-full flex-wrap gap-2">
              {amenityChips.map(({ label, status }) => {
                // amenity chip
                return (
                  <span
                    className={clsx(
                      "rounded-full border px-2 py-1",
                      "text-xs font-semibold shadow-sm",
                      status === "open" &&
                        "border-[#00c853] bg-[#eafff1] text-[#008c3a] dark:border-[#39ff88] dark:bg-[#003f1c] dark:text-[#39ff88]",
                      status === "closed" &&
                        "border-red-dark bg-red-light text-red-dark dark:border-red-light dark:bg-red-dark dark:text-white",
                      status === "unknown" &&
                        "border-gray-medium bg-white text-gray-darkest dark:border-gray-dark dark:bg-black/20 dark:text-white"
                    )}
                    key={label}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          </div>
        </header>
        <div className="grid grid-cols-2 gap-3 p-4">
          {renderProfileStat(
            "Vehicle deck",
            `${vehicleCapacity} cars`,
            CarIcon
          )}
          {renderProfileStat(
            "Cars / Trucks",
            `${regularVehicleCapacity} / ${tallVehicleCapacity}`,
            TruckIcon
          )}
          {renderProfileStat("Passengers", passengerCapacityLabel, UsersIcon)}
          {renderProfileStat("Class", vesselClassLabel, ShipIcon)}
          {/* wsf vessel link guard */}
          {vessel.vesselWatchUrl && (
            <ExternalPillLink
              className="col-span-2"
              href={vessel.vesselWatchUrl}
            >
              WSF vessel page
            </ExternalPillLink>
          )}
        </div>
      </article>
    );
    return renderTabbedDetails({
      forecastCard: renderForecastCard(),
      sailingCard: renderSailingCard(delayCard),
      vesselCard,
    });
  };

  const background = getScheduleRowClassName(sailingContext);

  return (
    <li
      className={clsx(
        "border-b",
        "border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.06)]",
        "flex flex-col",
        "relative",
        background
      )}
    >
      {renderHeader()}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            animate={{ height: "auto", opacity: 1, y: 0 }}
            exit={{ height: 0, opacity: 0, y: -6 }}
            initial={{ height: 0, opacity: 0, y: -6 }}
            key="details"
            style={{ overflow: "hidden" }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {renderDetails()}
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
};
