import clsx from "clsx";
import React, { useEffect, useRef, useState } from "react";
import type {
  RecommendationOrigin,
  RecommendationOutcome,
  TravelMode,
} from "shared/contracts/sailingRecommendations";
import type { Schedule } from "shared/contracts/schedules";
import {
  getLegacySailingRecommendationRevision,
  getSailingRecommendationRevision,
} from "shared/lib/sailingRecommendationRevision";

import BicycleIcon from "~/static/images/icons/solid/bicycle.svg";
import BusIcon from "~/static/images/icons/solid/bus.svg";
import CarIcon from "~/static/images/icons/solid/car.svg";
import LocationIcon from "~/static/images/icons/solid/location.svg";
import WalkingIcon from "~/static/images/icons/solid/walking.svg";

import { AddressAutocomplete } from "../../components/AddressAutocomplete";
import { NavigationFormSkeleton } from "../../components/NavigationFormSkeleton";
import { RoutePageIntro } from "../../components/RoutePageIntro";
import { trackUsefulEvent } from "../../lib/analytics";
import { requestForegroundLocation } from "../../lib/geo";
import {
  getSailingRecommendation,
  type SailingRecommendationResult,
} from "../../lib/sailingRecommendations";
import {
  parseSailingTrip,
  type SailingTrip,
  withSailingTrip,
} from "../../lib/sailingTrip";
import { SailingEstimateResults } from "./SailingEstimateResults";
import { SailingEstimateSkeleton } from "./SailingEstimateSkeleton";

const MODES: {
  Icon: React.FunctionComponent<React.SVGAttributes<SVGElement>>;
  label: string;
  value: TravelMode;
}[] = [
  { Icon: CarIcon, label: "Drive", value: "drive" },
  { Icon: WalkingIcon, label: "Walk", value: "walk" },
  { Icon: BicycleIcon, label: "Cycle", value: "bicycle" },
  { Icon: BusIcon, label: "Transit", value: "transit" },
];
const BUFFER_KEY = "ferry-fyi-sailing-buffer-minutes";
// share the app's field sizing and green focus treatment
const CONTROL_CLASSES =
  "field m-0 rounded-xl border-black/15 text-sm font-medium shadow-sm placeholder:text-gray-dark focus:border-green-dark focus:ring-2 focus:ring-green-dark/20 dark:border-white/20 dark:bg-blue-darkest dark:text-white dark:placeholder:text-gray-light dark:focus:border-green-light dark:focus:ring-green-light/20";
// retain a visible keyboard focus ring on shared action buttons
const ACTION_FOCUS_CLASSES =
  "focus-visible:ring-2 focus-visible:ring-green-dark focus-visible:ring-offset-2 dark:focus-visible:ring-green-light dark:focus-visible:ring-offset-blue-dark";
const FAILURE_COPY: Record<string, string> = {
  "configuration-unavailable":
    "Travel estimates are not enabled yet. You can still use the Schedule tab.",
  "ferry-route-recursion":
    "The available route includes ferry travel or cannot rule it out. Try a land-based origin.",
  "origin-needs-correction":
    "That origin could not be matched precisely. Enter a more specific address.",
  "provider-quota-unavailable": "Travel estimates are busy. Try again shortly.",
  "no-route": "No route is available for this travel method.",
  "provider-timeout": "The travel estimate took too long. Try again.",
  "schedule-unavailable":
    "The current schedule is unavailable. Refresh the schedule and try again.",
  "stale-result": "The schedule changed while estimating. Try again.",
};

interface ScheduleReadinessProps {
  isRefreshing: boolean;
  loadError: Error | null;
  onReload?: () => Promise<void>;
  ready: boolean;
}

// settle failed reads to recovery while pending controls use their skeleton
const ScheduleReadiness = ({
  isRefreshing,
  loadError,
  onReload,
  ready,
}: ScheduleReadinessProps): React.ReactElement | null => {
  // ready and actively loading schedules need no error announcement
  if (ready || !loadError) {
    return null;
  }
  return (
    <div
      className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-700 dark:bg-red-950/30 dark:text-red-100"
      role="alert"
    >
      <p className="font-semibold">Navigation could not load</p>
      <p className="mt-1">
        Ferry FYI could not load the schedule needed for your trip.
      </p>
      {onReload ? (
        <button
          className={clsx("button button-secondary mt-3", ACTION_FOCUS_CLASSES)}
          disabled={isRefreshing}
          onClick={() => {
            // retry only the schedule without requesting an origin
            onReload().catch(() => undefined);
          }}
          type="button"
        >
          {isRefreshing ? "Retrying…" : "Retry schedule"}
        </button>
      ) : null}
    </div>
  );
};

// calculate a rendered response revision only with its current schedule
const getRenderedRevision = (
  response: SailingRecommendationResult | null,
  schedule: Schedule | null
): string | null => {
  // responses without their schedule cannot be reconciled
  if (!response || !schedule) {
    return null;
  }
  return response.protocolVersion === "v1"
    ? getLegacySailingRecommendationRevision(schedule)
    : getSailingRecommendationRevision(schedule);
};

// restore bounded URL controls with the saved non-sensitive buffer as fallback
const readTrip = (): SailingTrip => {
  // server rendering has no browser URL or preferences
  if (typeof window === "undefined") {
    return { mode: "drive", buffer: 5, address: "" };
  }
  let defaultBuffer = 5;
  try {
    const saved = window.localStorage.getItem(BUFFER_KEY);
    const value = saved === null ? 5 : Number(saved);
    // ignore corrupt saved preferences
    if (Number.isInteger(value) && value >= 0 && value <= 60) {
      defaultBuffer = value;
    }
  } catch {
    // storage is optional and never contains an address
  }
  return parseSailingTrip(
    window.location.search,
    window.location.hash,
    defaultBuffer
  );
};

// render one user-initiated leave-now estimate without background tracking
export const SailingRecommendationCard = ({
  afterForm,
  afterIntroduction,
  isScheduleRefreshing = false,
  onReloadSchedule,
  onRefreshSchedule,
  scheduleLoadError = null,
  schedule,
}: {
  afterForm?: React.ReactNode;
  afterIntroduction?: React.ReactNode;
  isScheduleRefreshing?: boolean;
  onReloadSchedule?: () => Promise<void>;
  onRefreshSchedule: () => Promise<Schedule | null>;
  schedule: Schedule | null;
  scheduleLoadError?: Error | null;
}): React.ReactElement => {
  const [trip, setTrip] = useState(readTrip);
  const { address, buffer, mode } = trip;
  const [estimateResult, setEstimateResult] = useState<{
    actionOutcome: RecommendationOutcome;
    browserRevisionBeforeRequest: string;
    data: SailingRecommendationResult;
    requestId: number;
    scheduleRevision: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [expiredRequestId, setExpiredRequestId] = useState<number | null>(null);
  const requestIdentity = useRef(0);
  const emittedRequestIdentity = useRef<number | null>(null);
  const estimateElement = useRef<HTMLDivElement>(null);
  const response = estimateResult?.data ?? null;
  // use the negotiated fingerprint without weakening the current protocol's guard
  const revision = getRenderedRevision(response, schedule);

  // replace rather than append history while preserving router state and route parameters
  useEffect(() => {
    const url = withSailingTrip(window.location.href, trip);
    window.history.replaceState(window.history.state, "", url);
  }, [trip]);

  // reveal the committed estimate skeleton when an explicit request begins
  useEffect(() => {
    // leave form edits and completed results at the rider's chosen scroll position
    if (loading) {
      estimateElement.current?.scrollIntoView?.({ block: "start" });
    }
  }, [loading]);

  // restore shared controls on browser history changes without requesting an estimate
  useEffect(() => {
    const restore = (): void => {
      requestIdentity.current += 1;
      setTrip(readTrip());
      setEstimateResult(null);
      setMessage("");
      setLoading(false);
      setExpiredRequestId(null);
    };
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    // release URL listeners when leaving navigation
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("hashchange", restore);
    };
  }, []);

  // update controls atomically without overwriting edits during asynchronous location lookup
  const updateTrip = (patch: Partial<SailingTrip>): void => {
    setTrip((current) => ({ ...current, ...patch }));
  };

  // invalidate results on navigation or method changes while retaining the shared address
  useEffect(() => {
    requestIdentity.current += 1;
    setEstimateResult(null);
    setMessage("");
    setLoading(false);
    setExpiredRequestId(null);
    // invalidate any asynchronous completion after unmount
    return () => {
      requestIdentity.current += 1;
    };
  }, [schedule?.key, mode]);

  // expire only the result belonging to this foreground request
  useEffect(() => {
    // failures do not carry usable route bands
    if (
      !estimateResult ||
      estimateResult.data.bufferOutcomeBands.length === 0
    ) {
      return;
    }
    const { data, requestId } = estimateResult;
    const timeout = window.setTimeout(
      () => {
        // an older timer must never expire a newer origin's result
        if (requestIdentity.current === requestId) {
          setExpiredRequestId(requestId);
        }
      },
      Math.max(0, data.validUntil * 1000 - Date.now())
    );
    // release the foreground expiry timer
    return () => window.clearTimeout(timeout);
  }, [estimateResult]);

  // persist the buffer without ever storing an origin
  const changeBuffer = (value: number): void => {
    // reject incomplete numeric input
    if (!Number.isInteger(value) || value < 0 || value > 60) {
      return;
    }
    updateTrip({ buffer: value });
    try {
      window.localStorage.setItem(BUFFER_KEY, String(value));
    } catch {
      // storage access is optional
    }
  };

  // resolve and refresh one explicitly requested origin without paid retries
  const estimate = async (
    useLocation: boolean,
    selectedOrigin?: RecommendationOrigin
  ): Promise<void> => {
    const requestSchedule = schedule;
    // unavailable schedules must never trigger location or provider work
    if (!requestSchedule) {
      return;
    }
    const identity = ++requestIdentity.current;
    // freeze both browser fingerprints before any asynchronous schedule reads
    const browserRevisionsBeforeRequest = {
      v1: getLegacySailingRecommendationRevision(requestSchedule),
      v2: getSailingRecommendationRevision(requestSchedule),
    };
    setLoading(true);
    setEstimateResult(null);
    setMessage("");
    setExpiredRequestId(null);
    let stage: "origin" | "schedule" | "estimate" = "origin";
    try {
      let origin: RecommendationOrigin;
      // acquire a single foreground fix only after the user's tap
      if (useLocation) {
        const location = await requestForegroundLocation();
        // handle denial without exposing or retaining location details
        if (!location) {
          // ignore a response belonging to another route or mode
          if (requestIdentity.current === identity) {
            setMessage("Location is unavailable. Enter an address instead.");
          }
          return;
        }
        origin = {
          kind: "coordinates",
          latitude: location.latitude,
          longitude: location.longitude,
        };
      } else {
        // a selected place is already explicit and must not use stale input state
        origin = selectedOrigin ?? { kind: "address", address: address.trim() };
      }
      // avoid clearing new input or starting paid work after navigation
      if (requestIdentity.current !== identity) {
        return;
      }
      // a successful location fix must not leave a different address in the shared link
      if (useLocation) {
        updateTrip({ address: "" });
      }
      stage = "schedule";
      let freshSchedule = await onRefreshSchedule();
      // ignore a cache completion belonging to another route or method
      if (requestIdentity.current !== identity) {
        return;
      }
      // refuse a missing or cross-route snapshot before requesting directions
      if (
        !freshSchedule ||
        freshSchedule.key !== requestSchedule.key ||
        freshSchedule.date !== requestSchedule.date ||
        freshSchedule.terminalId !== requestSchedule.terminalId ||
        freshSchedule.mateId !== requestSchedule.mateId
      ) {
        throw new Error("Schedule refresh unavailable");
      }
      // freeze the fresh cache before either protocol's provider request
      const freshRevisions = {
        v1: getLegacySailingRecommendationRevision(freshSchedule),
        v2: getSailingRecommendationRevision(freshSchedule),
      };
      stage = "estimate";
      const result = await getSailingRecommendation({
        arrivingTerminalId: requestSchedule.mateId,
        bufferMinutes: buffer,
        departingTerminalId: requestSchedule.terminalId,
        mode,
        origin,
      });
      // never reconcile an obsolete provider completion
      if (requestIdentity.current !== identity) {
        return;
      }
      // a rolling or rollback task may serve only the original endpoint
      const getRevision =
        result.protocolVersion === "v1"
          ? getLegacySailingRecommendationRevision
          : getSailingRecommendationRevision;
      let freshRevision = freshRevisions[result.protocolVersion];
      // inventory can advance while google calculates directions
      if (
        result.bufferOutcomeBands.length > 0 &&
        result.revision !== freshRevision
      ) {
        stage = "schedule";
        freshSchedule = await onRefreshSchedule();
        // ignore an obsolete free reconciliation without another paid request
        if (requestIdentity.current !== identity) {
          return;
        }
        // keep the bounded reconciliation within the same route and ferry day
        if (
          !freshSchedule ||
          freshSchedule.key !== requestSchedule.key ||
          freshSchedule.date !== requestSchedule.date ||
          freshSchedule.terminalId !== requestSchedule.terminalId ||
          freshSchedule.mateId !== requestSchedule.mateId
        ) {
          throw new Error("Schedule refresh unavailable");
        }
        freshRevision = getRevision(freshSchedule);
      }
      const actionOutcome =
        result.bufferOutcomeBands.find((band) => {
          // freeze the outcome returned for the requested buffer
          return (
            buffer >= band.minimumBufferMinutes &&
            buffer <= band.maximumBufferMinutes
          );
        })?.outcome ?? result.outcome;
      setEstimateResult({
        actionOutcome,
        browserRevisionBeforeRequest:
          browserRevisionsBeforeRequest[result.protocolVersion],
        data: result,
        requestId: identity,
        scheduleRevision: freshRevision,
      });
    } catch {
      // render a sanitized error instead of logging request-bearing objects
      if (requestIdentity.current === identity) {
        setMessage(
          stage === "schedule"
            ? "Could not refresh the ferry schedule. Try again."
            : "Could not estimate this trip. Try again."
        );
      }
    } finally {
      // settle only the current explicit request
      if (requestIdentity.current === identity) {
        setLoading(false);
      }
    }
  };

  const outcome =
    response?.bufferOutcomeBands.find((band) => {
      // use the server's selection without another provider call
      return (
        buffer >= band.minimumBufferMinutes &&
        buffer <= band.maximumBufferMinutes
      );
    })?.outcome ?? response?.outcome;
  // tolerate only the pre-request browser snapshot while its fresh read renders
  const stale = Boolean(
    estimateResult &&
    response &&
    response.bufferOutcomeBands.length > 0 &&
    (expiredRequestId === estimateResult.requestId ||
      response.revision !== estimateResult.scheduleRevision ||
      (response.revision !== revision &&
        estimateResult.browserRevisionBeforeRequest !== revision) ||
      response.validUntil * 1000 <= Date.now())
  );

  // qualify the first usable render of each current explicit request
  useEffect(() => {
    const actionOutcome = estimateResult?.actionOutcome;
    // failures, stale results and obsolete requests remain silent
    if (
      !estimateResult ||
      !response ||
      stale ||
      estimateResult.requestId !== requestIdentity.current ||
      emittedRequestIdentity.current === estimateResult.requestId ||
      response.arrivalAt === null ||
      !actionOutcome?.sailing ||
      (actionOutcome.result !== "recommended" &&
        actionOutcome.result !== "timing-only")
    ) {
      return;
    }
    emittedRequestIdentity.current = estimateResult.requestId;
    trackUsefulEvent("trip_plan_available", {
      result:
        actionOutcome.result === "timing-only" ? "timing_only" : "recommended",
      travel_mode: response.mode,
    });
  }, [estimateResult, response, stale]);

  return (
    <div>
      {/* keep the navigation page open rather than nesting it in a padded card */}
      <section aria-labelledby="sailing-recommendation-title">
        <RoutePageIntro
          id="sailing-recommendation-title"
          title="What boat will I make?"
          description="If you leave now, estimate arrival and your earliest likely sailing."
        />
        {afterIntroduction}
        {/* keep trip controls centered without narrowing the shared page intro */}
        <div className="mx-auto w-full max-w-2xl">
          <ScheduleReadiness
            isRefreshing={isScheduleRefreshing}
            loadError={scheduleLoadError}
            onReload={onReloadSchedule}
            ready={Boolean(schedule)}
          />
          {/* reserve only schedule-dependent controls during the initial read */}
          {!schedule && !scheduleLoadError ? <NavigationFormSkeleton /> : null}
          {/* retain the mounted trip state while swapping pending controls for the real form */}
          {schedule ? (
            <>
              <div className="mt-5 space-y-4">
                <fieldset>
                  <legend className="text-sm font-semibold">
                    Travel method
                  </legend>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {MODES.map(({ Icon, label, value }) => {
                      // render one selectable travel method
                      const active = mode === value;
                      return (
                        <button
                          aria-pressed={active}
                          className={clsx(
                            "flex min-h-24 min-w-0 flex-col items-center justify-center rounded-xl border px-2 py-3 text-center text-sm font-medium transition",
                            ACTION_FOCUS_CLASSES,
                            active
                              ? "border-green-dark bg-green-dark text-white"
                              : "border-black/15 bg-white hover:border-green-dark dark:border-white/20 dark:bg-black/20 dark:hover:border-green-light"
                          )}
                          key={value}
                          onClick={() => {
                            // select a method without acquiring a new origin
                            updateTrip({ mode: value });
                          }}
                          type="button"
                        >
                          <Icon aria-hidden className="mb-2 h-8 w-8" />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <label className="flex min-w-0 flex-col gap-2 text-sm font-semibold">
                  <span>Safety buffer</span>
                  <div className="relative">
                    <input
                      aria-label="Safety buffer (minutes)"
                      className={clsx(CONTROL_CLASSES, "pr-12")}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={60}
                      step={1}
                      value={buffer}
                      onChange={(event) => {
                        // adjust the non-sensitive buffer preference
                        changeBuffer(Number(event.target.value));
                      }}
                    />
                    <span
                      aria-hidden
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-gray-dark dark:text-gray-light"
                    >
                      min
                    </span>
                  </div>
                </label>
              </div>
              {/* keep white action text readable on hover */}
              <button
                className={clsx(
                  "button button-primary mt-4 w-full hover:bg-blue-darkest",
                  ACTION_FOCUS_CLASSES
                )}
                disabled={loading || !schedule}
                onClick={() => {
                  // start only the tapped foreground estimate
                  estimate(true);
                }}
                type="button"
              >
                <LocationIcon aria-hidden className="button-icon text-lg" />
                <span className="button-label">Use my location</span>
              </button>
              <div
                aria-hidden
                className="mt-5 flex items-center gap-3 text-xs font-medium text-gray-dark dark:text-gray-light"
              >
                <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
                <span>or</span>
                <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
              </div>
              <form
                className="mt-4 space-y-3"
                onSubmit={(event) => {
                  // prevent navigation for an explicit manual-origin request
                  event.preventDefault();
                  estimate(false);
                }}
              >
                <AddressAutocomplete
                  className={CONTROL_CLASSES}
                  disabled={loading}
                  onChange={(value, placeId) => {
                    // selecting a google suggestion is an explicit fresh estimate
                    updateTrip({ address: value });
                    // use the selected place id without a second submit
                    if (placeId && schedule) {
                      estimate(false, { kind: "place", placeId });
                    } else {
                      // raw typing clears the old result without requesting directions
                      requestIdentity.current += 1;
                      setEstimateResult(null);
                      setExpiredRequestId(null);
                      setMessage("");
                      setLoading(false);
                    }
                  }}
                  value={address}
                />
                <button
                  className={clsx(
                    "button button-secondary w-full",
                    ACTION_FOCUS_CLASSES
                  )}
                  disabled={loading || !schedule || !address.trim()}
                  type="submit"
                >
                  Estimate trip
                </button>
              </form>
            </>
          ) : null}
          {/* keep contextual content outside form controls and result announcements */}
          {afterForm}
          <div
            ref={estimateElement}
            aria-live="polite"
            aria-busy={loading}
            className="mt-4 text-sm"
          >
            {loading && <SailingEstimateSkeleton />}
            {message && <p role="status">{message}</p>}
            {stale && (
              <p role="status">
                This estimate expired or the schedule changed. Use your location
                or enter an address again to refresh.
              </p>
            )}
            {!stale && response && (
              <>
                {response.arrivalAt !== null && (
                  <SailingEstimateResults
                    buffer={buffer}
                    outcome={outcome}
                    response={response}
                  />
                )}
                {(outcome?.result === "routing-unavailable" ||
                  outcome?.result === "schedule-unavailable") && (
                  <p>
                    {FAILURE_COPY[outcome.reason ?? ""] ??
                      "A travel estimate is unavailable. Try again shortly."}
                  </p>
                )}
                {outcome?.result === "no-catchable-sailing" && (
                  <p>
                    {response.sailingAssessments?.length
                      ? "No sailing fits the point arrival and buffer. The chances shown account for arrival and space uncertainty."
                      : "No remaining sailing fits this trip and buffer."}
                  </p>
                )}
                {response.warnings.map((warning, index) => {
                  // omit only the unwanted toll notice from this arrival estimator
                  if (
                    /^this route has (?:tolls|tools)[.!]?$/i.test(
                      warning.trim()
                    )
                  ) {
                    return null;
                  }
                  // retain safety and other provider warnings as escaped text
                  return (
                    <p className="mt-2 text-xs" key={index}>
                      {warning}
                    </p>
                  );
                })}
              </>
            )}
          </div>
          <p className="mt-4 border-t border-black/10 pt-4 text-xs leading-relaxed text-gray-dark dark:border-white/10 dark:text-gray-light">
            Lines outside the toll booth are not included. Estimates do not
            guarantee boarding.
          </p>
        </div>
      </section>
      {!stale && response?.arrivalAt !== null && response && (
        <p
          className="whitespace-nowrap px-4 py-2 text-center text-xs font-normal not-italic tracking-normal text-[#5e5e5e] dark:text-white"
          translate="no"
        >
          Google Maps · ©{new Date().getFullYear()} Google
        </p>
      )}
    </div>
  );
};
