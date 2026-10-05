import { Capacitor } from "@capacitor/core";
import clsx from "clsx";
import { DateTime } from "luxon";
import React, { useEffect, useState } from "react";
import type {
  RecommendationOutcome,
  RecommendedSailing,
  SailingAssessment,
  SailingRecommendationResponse,
} from "shared/contracts/sailingRecommendations";

import type { TimelineSailing } from "~/lib/sailingCapacityTimeline";
import { getSailingTripShareUrl } from "~/lib/sailingTrip";
import ShareIcon from "~/static/images/icons/solid/share-alt.svg";

import { SailingTimingTimeline } from "./SailingTimingTimeline";

// format terminal-local times consistently
const timeLabel = (seconds: number): string =>
  DateTime.fromSeconds(seconds, { zone: "America/Los_Angeles" }).toFormat(
    "h:mm a"
  );

// share the displayed percentage with its time and chance colors
const probabilityPercent = (probability: number): number =>
  Math.max(5, Math.min(95, Math.round(probability * 20) * 5));

// color sailing times and percentages by the displayed chance
const chanceColorClassName = (
  probability: number | null | undefined
): string => {
  // unavailable chances remain neutral rather than looking impossible
  if (probability === null || probability === undefined) {
    return "text-gray-dark dark:text-gray-light";
  }
  const percent = probabilityPercent(probability);
  // mark displayed chances at or below thirty percent as low
  if (percent <= 30) {
    return "text-red-700 dark:text-red-300";
  }
  // keep the middle band orange until the displayed chance reaches seventy
  if (percent < 70) {
    return "text-orange-700 dark:text-orange-300";
  }
  return "text-green-dark dark:text-green-light";
};

// avoid implying precision or certainty from assumed priors
const probabilityLabel = (
  probability: number | null | undefined,
  hardZero = false
): string => {
  // departures stay impossible even when inventory was unknown
  if (hardZero) {
    return "0%";
  }
  // distinguish missing inventory from impossible boarding
  if (probability === null || probability === undefined) {
    return "Unknown";
  }
  // retain small and large modeled tails
  if (probability < 0.025) {
    return "<5%";
  }
  // never present modeled certainty
  if (probability > 0.975) {
    return ">95%";
  }
  return `${probabilityPercent(probability)}%`;
};

// expire a sailing independently of its foreground travel estimate
const hasDeparted = (sailing: SailingAssessment | null, now: number): boolean =>
  Boolean(
    sailing &&
    (sailing.eligibilityReason === "departed" ||
      sailing.projectedDepartureAt <= now)
  );

// display actual-cutoff boarding chance rather than the preferred safety-margin target
const sailingProbability = (
  sailing: SailingAssessment | null,
  now: number
): number | null | undefined =>
  hasDeparted(sailing, now) ? 0 : sailing?.chance.probabilities[0];

// preserve observed and structural impossibility separately from modeled tails
const chanceLabel = (sailing: SailingAssessment | null, now: number): string =>
  probabilityLabel(
    sailingProbability(sailing, now),
    Boolean(
      hasDeparted(sailing, now) ||
      sailing?.eligibilityReason ||
      sailing?.capacity?.state === "already-full"
    )
  );

// never present an internal vessel number as an assigned vessel name
const vesselLabel = (name: string): string =>
  /^(?:(?:vessel|boat)\s*)?\d+$/iu.test(name.trim())
    ? "Vessel unavailable"
    : name;

// retain distinct same-time vessels within one schedule snapshot
const sailingKey = (sailing: RecommendedSailing): string =>
  sailing.sailingId ?? `${sailing.scheduledDepartureAt}:${sailing.vesselName}`;

// select the deterministic recommendation and its chronological neighbors
const displayedSailings = (
  response: SailingRecommendationResponse,
  outcome: RecommendationOutcome | undefined,
  buffer: number
): (RecommendedSailing | null)[] => {
  const assessments = response.sailingAssessments ?? [];
  // preserve compatibility without inventing adjacent sailing data
  if (assessments.length === 0) {
    return [null, outcome?.sailing ?? null, null];
  }
  let index = assessments.findIndex(
    // match the selected sailing independently of its projected delay
    (sailing) =>
      outcome?.sailing && sailingKey(sailing) === sailingKey(outcome.sailing)
  );
  // retain nearby estimates even when the point selector finds no sailing
  if (index < 0) {
    index = assessments.findIndex(
      // locate the nearest future point departure
      (sailing) =>
        sailing.projectedDepartureAt >= (response.arrivalAt ?? 0) + buffer * 60
    );
  }
  // show the last sailing when every remaining point departure is too early
  if (index < 0) {
    index = assessments.length - 1;
  }
  return [
    assessments[index - 1] ?? null,
    assessments[index],
    assessments[index + 1] ?? null,
  ];
};

// show combined uncertainty without issuing another travel request
export const SailingEstimateResults = ({
  buffer,
  outcome,
  response,
}: {
  buffer: number;
  outcome: RecommendationOutcome | undefined;
  response: SailingRecommendationResponse;
}): React.ReactElement => {
  // a fresh estimate defaults to Estimated rather than retaining an older selection
  const [selection, setSelection] = useState<{
    response: SailingRecommendationResponse;
    key: string;
  } | null>(null);
  const [shareMessage, setShareMessage] = useState("");
  const [sharing, setSharing] = useState(false);
  // clear temporary share feedback without retaining the link in component state
  useEffect(() => {
    // idle sharing needs no timer
    if (!shareMessage) {
      return;
    }
    const timeout = window.setTimeout(() => setShareMessage(""), 2500);
    // cancel feedback when results leave the page
    return () => window.clearTimeout(timeout);
  }, [shareMessage]);

  // share editable controls rather than expiring predictions or precise coordinates
  const share = async (): Promise<void> => {
    setSharing(true);
    setShareMessage("");
    try {
      const url = getSailingTripShareUrl(
        window.location.href,
        Capacitor.isNativePlatform(),
        process.env.BASE_URL || "https://ferry.fyi"
      );
      const { Share } = await import("@capacitor/share");
      const { value: canShare } = await Share.canShare();
      const title = "What boat will I make?";
      // prefer the platform share sheet when supported
      if (canShare) {
        await Share.share({
          title,
          text: title,
          dialogTitle: title,
          url,
        });
      } else if (navigator.clipboard) {
        // copy only after the explicit share action
        await navigator.clipboard.writeText(url);
        setShareMessage("Link copied.");
      } else {
        // never claim a copy when no clipboard is available
        setShareMessage("Sharing is unavailable on this device.");
      }
    } catch {
      // never log a share payload containing a starting address
      setShareMessage("Could not share this trip.");
    } finally {
      setSharing(false);
    }
  };
  const [clock, setClock] = useState(() => Date.now() / 1000);
  const now = Math.max(clock, Date.now() / 1000);
  // update at each projected departure without another location or provider request
  useEffect(() => {
    const nextDeparture = Math.min(
      ...(response.sailingAssessments ?? [])
        .map((sailing) => sailing.projectedDepartureAt)
        .filter(
          // the parent expires results before later sailings need a clock update
          (departureAt) =>
            departureAt > now && departureAt < response.validUntil
        )
    );
    // already elapsed or absent sailings need no background timer
    if (!Number.isFinite(nextDeparture)) {
      return;
    }
    const timeout = window.setTimeout(
      // rerender every displayed chance at the local departure boundary
      () => setClock(Date.now() / 1000),
      Math.max(1, (nextDeparture - now) * 1000)
    );
    // discard the old result's departure timer
    return () => window.clearTimeout(timeout);
  }, [now, response]);
  const sailings = displayedSailings(response, outcome, buffer);
  // retain a clicked sailing only while it belongs to this result and displayed trio
  const expanded =
    sailings.find(
      (sailing) =>
        sailing &&
        selection?.response === response &&
        sailingKey(sailing) === selection.key
    ) ??
    sailings[1] ??
    sailings.find((sailing) => sailing !== null) ??
    null;
  // keep all three inventories tied to the same estimate snapshot
  const chartSailings: TimelineSailing[] = sailings
    .filter((sailing): sailing is RecommendedSailing => sailing !== null)
    .map((sailing) => {
      // a forecast event probability does not establish an occupancy curve
      const assessment = response.sailingAssessments?.find(
        (candidate) => sailingKey(candidate) === sailingKey(sailing)
      );
      return {
        ...sailing,
        eligibilityReason: assessment?.eligibilityReason,
        capacity:
          assessment?.chance.forecastFullProbability === undefined
            ? sailing.capacity
            : null,
      };
    });
  let trafficLabel =
    response.mode === "drive" ? "Traffic unavailable" : "Travel time";
  // describe color without depending on color perception
  if (response.trafficLevel) {
    trafficLabel = `${response.trafficLevel[0].toUpperCase()}${response.trafficLevel.slice(1)} traffic`;
  }
  // share one traffic palette between the arrival time and both chart annotations
  const arrivalColorClassName = clsx({
    "text-green-dark dark:text-green-light": response.trafficLevel === "light",
    "text-amber-700 dark:text-amber-300": response.trafficLevel === "moderate",
    "text-red-700 dark:text-red-300": response.trafficLevel === "heavy",
    "text-gray-dark dark:text-gray-light": !response.trafficLevel,
  });

  return (
    <div className="mt-5">
      {/* share the sailing columns while keeping the arrival time centered */}
      <div className="grid grid-cols-3 items-center gap-x-2 text-center">
        {response.arrivalAt !== null && (
          <>
            <p className="col-span-3 text-xs font-semibold uppercase tracking-wide text-gray-dark dark:text-gray-light">
              Estimated terminal arrival
            </p>
            <p
              className={clsx(
                "col-start-2 row-start-2 mt-1 justify-self-center whitespace-nowrap text-2xl font-black tracking-tight min-[375px]:text-3xl sm:text-4xl",
                arrivalColorClassName
              )}
            >
              {timeLabel(response.arrivalAt)}
            </p>
            <p className="col-span-3 row-start-3 mt-1 text-xs text-gray-dark dark:text-gray-light">
              {Math.ceil((response.durationSeconds ?? 0) / 60)} minutes ·{" "}
              <span>{trafficLabel}</span>
            </p>
          </>
        )}
        <button
          aria-label="Share trip"
          title="Share trip"
          className="col-start-3 row-start-2 mt-1 flex h-11 w-11 items-center justify-center justify-self-center rounded-lg text-gray-dark hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-green-dark dark:text-gray-light dark:hover:bg-white/10 dark:focus-visible:ring-green-light"
          disabled={sharing}
          onClick={() => {
            // share only in response to the icon tap
            share();
          }}
          type="button"
        >
          <ShareIcon aria-hidden className="h-5 w-5" />
        </button>
        {shareMessage && (
          <p
            className="col-span-3 mt-2 text-xs text-gray-dark dark:text-gray-light"
            role="status"
          >
            {shareMessage}
          </p>
        )}
      </div>
      <div
        className="mt-5 grid grid-cols-3 items-stretch gap-2"
        aria-label="Sailing estimates"
      >
        {sailings.map((sailing, index) => {
          // make the complete sailing block the single selection target
          const center = index === 1;
          const candidate =
            response.sailingAssessments?.find(
              // resolve this block's independent boarding assessment
              (entry) => sailing && sailingKey(entry) === sailingKey(sailing)
            ) ?? null;
          const active = Boolean(
            sailing && expanded && sailingKey(sailing) === sailingKey(expanded)
          );
          const label = ["Earlier", "Estimated", "Later"][index];
          const color = chanceColorClassName(
            sailingProbability(candidate, now)
          );
          return (
            <button
              aria-controls="sailing-chance-details"
              aria-expanded={active}
              aria-pressed={active}
              aria-label={
                sailing
                  ? `${label}: ${chanceLabel(candidate, now)}. Details for ${vesselLabel(sailing.vesselName)}`
                  : `${label}: No sailing`
              }
              className={clsx(
                "min-w-0 rounded-xl border px-1 py-3 text-center focus-visible:ring-2 focus-visible:ring-green-dark dark:focus-visible:ring-green-light sm:px-3",
                active
                  ? "border-green-dark/20 bg-green-lightest dark:border-green-light/25 dark:bg-green-dark/20"
                  : "border-transparent enabled:hover:bg-black/5 dark:enabled:hover:bg-white/5"
              )}
              data-departure-at={sailing?.projectedDepartureAt}
              disabled={!sailing}
              key={index}
              onClick={() => {
                // selection never collapses the chart or requests another paid route
                if (sailing) {
                  setSelection({ response, key: sailingKey(sailing) });
                }
              }}
              type="button"
            >
              <span
                data-sailing-label
                className={clsx(
                  "block text-xs",
                  active ? "font-bold" : "text-gray-dark dark:text-gray-light"
                )}
              >
                {label}
              </span>
              {sailing ? (
                <>
                  <span
                    data-sailing-time
                    className={clsx(
                      "mt-2 block whitespace-nowrap font-black tracking-tight",
                      center ? "text-xl sm:text-2xl" : "text-base sm:text-xl",
                      color
                    )}
                  >
                    {timeLabel(sailing.projectedDepartureAt)}
                  </span>
                  <span
                    data-sailing-vessel
                    className="mt-1 block break-words text-xs text-gray-dark dark:text-gray-light"
                  >
                    {vesselLabel(sailing.vesselName)}
                  </span>
                  <span
                    data-sailing-chance
                    className={clsx(
                      "mt-3 flex min-h-11 w-full items-center justify-center text-sm font-bold",
                      color
                    )}
                  >
                    {chanceLabel(candidate, now)}
                  </span>
                </>
              ) : (
                <span className="mt-3 block text-xs text-gray-dark dark:text-gray-light">
                  {
                    [
                      "No earlier sailing",
                      "No remaining sailing",
                      "No later sailing",
                    ][index]
                  }
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div id="sailing-chance-details">
        {expanded && response.arrivalAt !== null && (
          <SailingTimingTimeline
            arrivalColorClassName={arrivalColorClassName}
            arrivalAt={response.arrivalAt}
            now={response.recommendationAsOf}
            sailing={expanded}
            sailings={chartSailings}
            travelUncertainty={response.travelUncertainty}
          />
        )}
      </div>
    </div>
  );
};
