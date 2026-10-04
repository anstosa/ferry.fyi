import clsx from "clsx";
import { DateTime } from "luxon";
import React, { useState } from "react";
import type {
  RecommendationOutcome,
  RecommendedSailing,
  SailingAssessment,
  SailingRecommendationResponse,
} from "shared/contracts/sailingRecommendations";

import ChevronDownIcon from "~/static/images/icons/solid/chevron-down.svg";
import ChevronUpIcon from "~/static/images/icons/solid/chevron-up.svg";

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
  // distinguish missing inventory from impossible boarding
  if (probability === null || probability === undefined) {
    return "Unknown";
  }
  // preserve only observed or structural hard zeroes
  if (hardZero) {
    return "0%";
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

// preserve observed and structural impossibility separately from modeled tails
const chanceLabel = (
  sailing: SailingAssessment | null,
  buffer: number
): string =>
  probabilityLabel(
    sailing?.chance.probabilities[buffer],
    Boolean(
      sailing?.eligibilityReason || sailing?.capacity?.state === "already-full"
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sailings = displayedSailings(response, outcome, buffer);
  const expanded = sailings.find(
    // close a panel when its sailing leaves the displayed trio
    (sailing) => sailing && sailingKey(sailing) === expandedId
  );
  const assessment = response.sailingAssessments?.find(
    // resolve the shared full-width breakdown
    (sailing) => expanded && sailingKey(sailing) === sailingKey(expanded)
  );
  const capacity = expanded?.capacity;
  let trafficLabel =
    response.mode === "drive" ? "Traffic unavailable" : "Travel time";
  // describe color without depending on color perception
  if (response.trafficLevel) {
    trafficLabel = `${response.trafficLevel[0].toUpperCase()}${response.trafficLevel.slice(1)} traffic`;
  }

  return (
    <div className="mt-5">
      {response.arrivalAt !== null && (
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-dark dark:text-gray-light">
            Estimated terminal arrival
          </p>
          <p
            className={clsx("mt-1 text-4xl font-black tracking-tight", {
              "text-green-dark dark:text-green-light":
                response.trafficLevel === "light",
              "text-amber-700 dark:text-amber-300":
                response.trafficLevel === "moderate",
              "text-red-700 dark:text-red-300":
                response.trafficLevel === "heavy",
            })}
          >
            {timeLabel(response.arrivalAt)}
          </p>
          <p className="mt-1 text-xs text-gray-dark dark:text-gray-light">
            {Math.ceil((response.durationSeconds ?? 0) / 60)} minutes ·{" "}
            <span>{trafficLabel}</span>
          </p>
        </div>
      )}
      <div
        className="mt-5 grid grid-cols-3 items-start gap-2"
        aria-label="Sailing estimates"
      >
        {sailings.map((sailing, index) => {
          // emphasize the point-selected sailing while retaining adjacent chances
          const center = index === 1;
          const candidate =
            response.sailingAssessments?.find(
              // resolve this card's buffer-indexed estimate
              (entry) => sailing && sailingKey(entry) === sailingKey(sailing)
            ) ?? null;
          const active = Boolean(sailing && sailingKey(sailing) === expandedId);
          const label = ["Earlier", "Estimated", "Later"][index];
          const ChevronIcon = active ? ChevronUpIcon : ChevronDownIcon;
          return (
            <div
              className={clsx(
                "min-w-0 rounded-xl px-1 py-3 text-center sm:px-3",
                center
                  ? "border border-green-dark/20 bg-green-lightest dark:border-green-light/25 dark:bg-green-dark/20"
                  : "pt-4"
              )}
              key={index}
            >
              <p
                className={clsx(
                  "text-xs",
                  center ? "font-bold" : "text-gray-dark dark:text-gray-light"
                )}
              >
                {label}
              </p>
              {sailing ? (
                <>
                  <p
                    className={clsx(
                      "mt-2 whitespace-nowrap font-black tracking-tight",
                      center ? "text-xl sm:text-2xl" : "text-base sm:text-xl",
                      chanceColorClassName(
                        candidate?.chance.probabilities[buffer]
                      )
                    )}
                  >
                    {timeLabel(sailing.projectedDepartureAt)}
                  </p>
                  <p className="mt-1 break-words text-xs text-gray-dark dark:text-gray-light">
                    {vesselLabel(sailing.vesselName)}
                  </p>
                  <button
                    aria-controls="sailing-chance-details"
                    aria-expanded={active}
                    aria-label={`${label}: ${chanceLabel(candidate, buffer)}. ${active ? "Hide" : "Show"} details for ${vesselLabel(sailing.vesselName)}`}
                    className={clsx(
                      "mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg text-sm font-bold underline decoration-dotted underline-offset-4 focus-visible:ring-2 focus-visible:ring-green-dark dark:focus-visible:ring-green-light",
                      chanceColorClassName(
                        candidate?.chance.probabilities[buffer]
                      )
                    )}
                    onClick={() => {
                      // toggle details without requesting another paid route
                      setExpandedId(active ? null : sailingKey(sailing));
                    }}
                    type="button"
                  >
                    <span>{chanceLabel(candidate, buffer)}</span>
                    <ChevronIcon
                      aria-hidden
                      className="h-3 w-3 shrink-0"
                      data-direction={active ? "up" : "down"}
                    />
                  </button>
                </>
              ) : (
                <p className="mt-3 text-xs text-gray-dark dark:text-gray-light">
                  {
                    [
                      "No earlier sailing",
                      "No remaining sailing",
                      "No later sailing",
                    ][index]
                  }
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div id="sailing-chance-details" hidden={!expanded}>
        {expanded && response.arrivalAt !== null && (
          <div className="mt-3 rounded-xl border border-black/10 p-4 text-sm dark:border-white/15">
            <h3 className="font-bold">
              {timeLabel(expanded.projectedDepartureAt)} sailing details ·{" "}
              {vesselLabel(expanded.vesselName)}
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <dt>Estimated arrival</dt>
              <dd className="text-right">{timeLabel(response.arrivalAt)}</dd>
              {response.travelUncertainty && (
                <>
                  <dt>Planning arrival range</dt>
                  <dd className="text-right">
                    {timeLabel(response.travelUncertainty.earliestArrivalAt)}–
                    {timeLabel(response.travelUncertainty.latestArrivalAt)}
                  </dd>
                </>
              )}
              <dt>Safety buffer</dt>
              <dd className="text-right">{buffer} minutes</dd>
              <dt>Arrival + buffer</dt>
              <dd className="text-right">
                {timeLabel(response.arrivalAt + buffer * 60)}
              </dd>
              <dt>Arrival deadline with buffer</dt>
              <dd className="text-right">
                {timeLabel(
                  expanded.projectedDepartureAt -
                    expanded.operatorCutoffSeconds -
                    buffer * 60
                )}
              </dd>
              <dt>Boarding cutoff</dt>
              <dd className="text-right">
                {expanded.operatorCutoffSeconds / 60} minutes before departure
              </dd>
              <dt>Estimated departure</dt>
              <dd className="text-right">
                {timeLabel(expanded.projectedDepartureAt)}
              </dd>
              <dt>Scheduled departure</dt>
              <dd className="text-right">
                {timeLabel(expanded.scheduledDepartureAt)}
              </dd>
              {capacity && (
                <>
                  <dt>Estimated drive-up spaces at arrival</dt>
                  <dd className="text-right">
                    {capacity.predictedSpacesAtArrival === null
                      ? "Unavailable"
                      : Math.floor(capacity.predictedSpacesAtArrival)}
                  </dd>
                </>
              )}
              {assessment?.spacesAtArrivalRange && (
                <>
                  <dt>Modeled spaces across arrival range</dt>
                  <dd className="text-right">
                    {Math.floor(assessment.spacesAtArrivalRange.minimum)}–
                    {Math.ceil(assessment.spacesAtArrivalRange.maximum)}
                  </dd>
                </>
              )}
              {typeof capacity?.fillAt === "number" && (
                <>
                  <dt>Estimated fill time</dt>
                  <dd className="text-right">{timeLabel(capacity.fillAt)}</dd>
                </>
              )}
              {capacity?.fillRange && (
                <>
                  <dt>Planning fill range</dt>
                  <dd className="text-right">
                    {capacity.fillRange.earliest === null
                      ? "Unknown"
                      : timeLabel(capacity.fillRange.earliest)}
                    –
                    {capacity.fillRange.latest === null
                      ? "Unknown"
                      : timeLabel(capacity.fillRange.latest)}
                  </dd>
                </>
              )}
              {typeof capacity?.anchorAt === "number" && (
                <>
                  <dt>WSF capacity observed</dt>
                  <dd className="text-right">
                    {timeLabel(capacity.anchorAt)} (
                    {Math.ceil((capacity.anchorAgeSeconds ?? 0) / 60)} min old)
                  </dd>
                  <dt>Fill estimate confidence</dt>
                  <dd className="text-right">{capacity.confidence}</dd>
                  <dt>Observed drive-up spaces</dt>
                  <dd className="text-right">
                    {capacity.observedSpacesAtAnchor ?? "Unavailable"}
                  </dd>
                </>
              )}
              {assessment?.chance.depletionRateRange && (
                <>
                  <dt>Assumed depletion range</dt>
                  <dd className="text-right">
                    {assessment.chance.depletionRateRange.minimum.toFixed(1)}–
                    {assessment.chance.depletionRateRange.maximum.toFixed(1)}{" "}
                    spaces/min
                  </dd>
                </>
              )}
              {assessment && (
                <>
                  <dt>Timing chance with buffer</dt>
                  <dd className="text-right">
                    {probabilityLabel(
                      assessment.chance.timingProbabilities[buffer]
                    )}
                  </dd>
                </>
              )}
              {assessment?.chance.basis === "timing-and-capacity" && (
                <>
                  <dt>Space remaining chance</dt>
                  <dd className="text-right">
                    {probabilityLabel(
                      assessment.chance.capacityProbability,
                      capacity?.state === "already-full"
                    )}
                  </dd>
                </>
              )}
              {typeof response.trafficDelaySeconds === "number" && (
                <>
                  <dt>Estimated traffic delay</dt>
                  <dd className="text-right">
                    {Math.ceil(response.trafficDelaySeconds / 60)} minutes
                  </dd>
                </>
              )}
            </dl>
            {assessment?.eligibilityReason && (
              <p className="mt-3">
                This sailing is{" "}
                {assessment.eligibilityReason === "mode-ineligible"
                  ? "unavailable for this travel method"
                  : assessment.eligibilityReason}
                .
              </p>
            )}
            {capacity?.state === "already-full" && (
              <p className="mt-3">WSF reported zero drive-up spaces.</p>
            )}
            {capacity?.state === "not-expected-before-departure" && (
              <p className="mt-3">
                Drive-up space is not expected to reach zero before departure.
              </p>
            )}
            {response.mode === "drive" &&
              (assessment?.chance.probabilities[buffer] === null ||
                assessment?.chance.probabilities[buffer] === undefined) && (
                <p className="mt-3">
                  Drive-up availability could not be estimated. Timing alone
                  cannot establish your chance of making this sailing.
                </p>
              )}
          </div>
        )}
      </div>
    </div>
  );
};
