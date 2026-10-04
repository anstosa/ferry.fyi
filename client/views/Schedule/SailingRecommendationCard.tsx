import clsx from "clsx";
import React, { useEffect, useRef, useState } from "react";
import type {
  RecommendationOrigin,
  SailingRecommendationResponse,
  TravelMode,
} from "shared/contracts/sailingRecommendations";
import type { Schedule } from "shared/contracts/schedules";
import { getSailingRecommendationRevision } from "shared/lib/sailingRecommendationRevision";

import BicycleIcon from "~/static/images/icons/solid/bicycle.svg";
import BusIcon from "~/static/images/icons/solid/bus.svg";
import CarIcon from "~/static/images/icons/solid/car.svg";
import LocationIcon from "~/static/images/icons/solid/location.svg";
import WalkingIcon from "~/static/images/icons/solid/walking.svg";

import { AddressAutocomplete } from "../../components/AddressAutocomplete";
import { requestForegroundLocation } from "../../lib/geo";
import { getSailingRecommendation } from "../../lib/sailingRecommendations";
import { SailingEstimateResults } from "./SailingEstimateResults";

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

// render one user-initiated leave-now estimate without background tracking
export const SailingRecommendationCard = ({
  onRefreshSchedule,
  schedule,
}: {
  onRefreshSchedule?: () => Promise<Schedule | null>;
  schedule: Schedule;
}): React.ReactElement => {
  const [mode, setMode] = useState<TravelMode>("drive");
  const [buffer, setBuffer] = useState(5);
  const [address, setAddress] = useState("");
  const [estimateResult, setEstimateResult] = useState<{
    browserRevisionBeforeRequest: string;
    data: SailingRecommendationResponse;
    requestId: number;
    scheduleRevision: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [expiredRequestId, setExpiredRequestId] = useState<number | null>(null);
  const requestIdentity = useRef(0);
  const revision = getSailingRecommendationRevision(schedule);
  const response = estimateResult?.data ?? null;

  // restore only the non-sensitive safety margin
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(BUFFER_KEY);
      const value = saved === null ? 5 : Number(saved);
      // ignore corrupt or out-of-range preferences
      if (Number.isInteger(value) && value >= 0 && value <= 60) {
        setBuffer(value);
      }
    } catch {
      // storage access is optional
    }
  }, []);

  // discard origins and invalidate requests on navigation or mode changes
  useEffect(() => {
    requestIdentity.current += 1;
    setAddress("");
    setEstimateResult(null);
    setMessage("");
    setLoading(false);
    setExpiredRequestId(null);
    // invalidate any asynchronous completion after unmount
    return () => {
      requestIdentity.current += 1;
    };
  }, [schedule.key, mode]);

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
    setBuffer(value);
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
    const identity = ++requestIdentity.current;
    const browserRevisionBeforeRequest = revision;
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
      setAddress("");
      stage = "schedule";
      let freshSchedule = onRefreshSchedule
        ? await onRefreshSchedule()
        : schedule;
      // ignore a cache completion belonging to another route or method
      if (requestIdentity.current !== identity) {
        return;
      }
      // refuse a missing or cross-route snapshot before requesting directions
      if (
        !freshSchedule ||
        freshSchedule.key !== schedule.key ||
        freshSchedule.date !== schedule.date ||
        freshSchedule.terminalId !== schedule.terminalId ||
        freshSchedule.mateId !== schedule.mateId
      ) {
        throw new Error("Schedule refresh unavailable");
      }
      let freshRevision = getSailingRecommendationRevision(freshSchedule);
      stage = "estimate";
      const result = await getSailingRecommendation({
        arrivingTerminalId: schedule.mateId,
        bufferMinutes: buffer,
        departingTerminalId: schedule.terminalId,
        mode,
        origin,
      });
      // never reconcile an obsolete provider completion
      if (requestIdentity.current !== identity) {
        return;
      }
      // inventory can advance while google calculates directions
      if (
        onRefreshSchedule &&
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
          freshSchedule.key !== schedule.key ||
          freshSchedule.date !== schedule.date ||
          freshSchedule.terminalId !== schedule.terminalId ||
          freshSchedule.mateId !== schedule.mateId
        ) {
          throw new Error("Schedule refresh unavailable");
        }
        freshRevision = getSailingRecommendationRevision(freshSchedule);
      }
      setEstimateResult({
        browserRevisionBeforeRequest,
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

  return (
    <div className="m-3">
      <section
        aria-labelledby="sailing-recommendation-title"
        className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm ring-1 ring-black/5 sm:p-6 dark:border-white/10 dark:bg-blue-dark dark:ring-white/10"
      >
        <h2
          id="sailing-recommendation-title"
          className="text-xl font-black tracking-tight"
        >
          What boat will I make?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-dark dark:text-gray-light">
          If you leave now, estimate arrival and your earliest likely sailing.
        </p>
        <div className="mt-5 space-y-4">
          <fieldset>
            <legend className="text-sm font-semibold">Travel method</legend>
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
                      setMode(value);
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
          disabled={loading}
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
              setAddress(value);
              // use the selected place id without a second submit
              if (placeId) {
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
            disabled={loading || !address.trim()}
            type="submit"
          >
            Estimate trip
          </button>
        </form>
        <div aria-live="polite" aria-busy={loading} className="mt-4 text-sm">
          {loading && <p>Estimating your trip…</p>}
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
                  /^this route has (?:tolls|tools)[.!]?$/i.test(warning.trim())
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
