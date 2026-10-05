import { DateTime } from "luxon";
import React, { useEffect, useId, useRef, useState } from "react";
import type {
  RecommendedSailing,
  TravelUncertainty,
} from "shared/contracts/sailingRecommendations";

import {
  buildSailingCapacityTimeline,
  type TimelineSailing,
} from "~/lib/sailingCapacityTimeline";

interface Props {
  arrivalColorClassName?: string;
  arrivalAt: number;
  now: number;
  sailing: RecommendedSailing;
  sailings: TimelineSailing[];
  travelUncertainty?: TravelUncertainty | null;
}
const COLORS = {
  sailing: "text-sky-700 dark:text-sky-300",
  you: "text-gray-dark dark:text-gray-light",
  fill: "text-orange-700 dark:text-orange-300",
};
// distinguish a measured source from a modeled departure reset in accessible details
const CAPACITY_DESCRIPTIONS = {
  live: "Independent capacity area from its own live observation; predecessor carryover unknown.",
  "departure-reset": "Independent capacity area with modeled departure reset.",
  unknown: "Capacity or carryover unknown.",
};
type Color = keyof typeof COLORS;
interface Point {
  key?: string;
  at: number;
  color: Color;
  label: string;
  shortLabel: string;
}
interface Range {
  key?: string;
  color: Color;
  end: number;
  label: string;
  start: number;
}
interface Lane {
  color: Color;
  id: string;
  label: string;
  points: Point[];
  ranges: Range[];
}
interface Label {
  flipped: boolean;
  descent: number;
  point: Point;
  text: string;
  width: number;
  x: number;
  y: number;
}

// retain real model times without plotting the historical capacity observation
const buildLanes = ({
  arrivalAt,
  sailing,
  travelUncertainty,
}: Pick<Props, "arrivalAt" | "sailing" | "travelUncertainty">): Lane[] => {
  const you: Lane = {
    color: "you",
    id: "arrival",
    label: "Terminal arrival",
    points: [],
    ranges: [],
  };
  const sailingLane: Lane = {
    color: "sailing",
    id: "sailing",
    label: "Sailing",
    points: [],
    ranges: [],
  };
  // optional unknown times have no invented point
  const point = (
    lane: Lane,
    label: string,
    shortLabel: string,
    at: number | null | undefined
  ): void => {
    // skip missing or non-finite timestamps
    if (typeof at === "number" && Number.isFinite(at)) {
      lane.points.push({ at, color: lane.color, label, shortLabel });
    }
  };
  // bands require two supplied endpoints
  const range = (
    lane: Lane,
    label: string,
    start: number | null | undefined,
    end: number | null | undefined
  ): void => {
    // a one-sided range stays visibly unknown
    if (
      typeof start === "number" &&
      typeof end === "number" &&
      Number.isFinite(start) &&
      Number.isFinite(end)
    ) {
      lane.ranges.push({ color: lane.color, end, label, start });
    }
  };
  const cutoff = sailing.projectedDepartureAt - sailing.operatorCutoffSeconds;
  point(sailingLane, "Boarding cutoff", "Cutoff", cutoff);
  point(
    sailingLane,
    "Estimated departure",
    "Departure",
    sailing.projectedDepartureAt
  );
  // only a changed departure needs a scheduled marker and shift band
  if (sailing.scheduledDepartureAt !== sailing.projectedDepartureAt) {
    point(
      sailingLane,
      "Scheduled departure",
      "Scheduled",
      sailing.scheduledDepartureAt
    );
    range(
      sailingLane,
      "Departure shift",
      sailing.scheduledDepartureAt,
      sailing.projectedDepartureAt
    );
  }
  point(you, "Estimated arrival", "ETA", arrivalAt);
  point(
    you,
    "Earliest arrival",
    "Earliest",
    travelUncertainty?.earliestArrivalAt
  );
  point(you, "Latest arrival", "Latest", travelUncertainty?.latestArrivalAt);
  range(
    you,
    "Planning arrival range",
    travelUncertainty?.earliestArrivalAt,
    travelUncertainty?.latestArrivalAt
  );
  const fill: Lane = {
    color: "fill",
    id: "capacity",
    label: "Estimated drive-up capacity used",
    points: [],
    ranges: [],
  };
  return [sailingLane, you, fill];
};

const LABEL_SPACING = 22;
// keep rotated captions just inside the graph edges
const LABEL_LEFT_PADDING = 12;
type LabelMetrics = Record<string, { width: number; descent: number }>;

// space parallel captions horizontally while keeping each lane's baseline level
const placeLabels = (
  points: Point[],
  y: number,
  position: (at: number) => number,
  text: (point: Point) => string,
  metrics: LabelMetrics,
  maximumX = Infinity,
  flip = false
): Label[] => {
  const labels: Label[] = [];
  // assign collision-free offsets in right-to-left time order
  for (const point of [...points].sort((a, b) => b.at - a.at)) {
    const caption = text(point);
    const label: Label = {
      flipped: false,
      descent: metrics[caption]?.descent ?? 3,
      point,
      text: caption,
      width: metrics[caption]?.width ?? caption.length * 7,
      x: Math.min(
        position(point.at),
        (labels.at(-1)?.x ?? Infinity) - LABEL_SPACING,
        maximumX
      ),
      y: y + 16,
    };
    labels.push(label);
  }
  // contain long captions at the left edge without adding vertical offsets
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    const label = labels[index];
    label.x = Math.max(
      label.x,
      label.width * Math.SQRT1_2 + LABEL_LEFT_PADDING,
      (labels[index + 1]?.x ?? -Infinity) + LABEL_SPACING
    );
  }
  // a left-edge bank reads away from its markers rather than pointing back past them
  if (flip && labels.at(-1)!.x > position(labels.at(-1)!.point.at)) {
    const forward = [...labels].reverse();
    // align left edges in chronological order on the same baseline
    for (let index = 0; index < forward.length; index += 1) {
      const label = forward[index];
      label.flipped = true;
      label.x = Math.max(
        position(label.point.at),
        12,
        (forward[index - 1]?.x ?? -Infinity) + LABEL_SPACING
      );
    }
    // contain the outward-facing bank without changing marker coordinates
    for (let index = forward.length - 1; index >= 0; index -= 1) {
      const label = forward[index];
      label.x = Math.min(
        label.x,
        maximumX - (label.width + 12) * Math.SQRT1_2,
        (forward[index + 1]?.x ?? Infinity) - LABEL_SPACING
      );
    }
    return forward;
  }
  return labels;
};

// compare arrival and selected cutoff against independently sourced capacity areas
export const SailingTimingTimeline = (props: Props): React.ReactElement => {
  // inherit the displayed eta palette without guessing traffic severity
  const arrivalColorClassName = props.arrivalColorClassName ?? COLORS.you;
  const scroll = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(320);
  const [labelMetrics, setLabelMetrics] = useState<LabelMetrics>({});
  const id = useId();
  // retain readable captions and contain any necessary narrow-screen scrolling
  useEffect(() => {
    const element = scroll.current;
    // server rendering cannot measure a container
    if (!element) {
      return;
    }
    // resize the shared scale without shrinking its annotation text
    const measure = (): void =>
      setAvailableWidth(Math.floor(element.clientWidth));
    measure();
    // older webviews can still react to viewport changes
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // release observation when the details panel leaves the page
    return () => observer.disconnect();
  }, []);

  const start = props.now;
  // every selection retains the displayed Later sailing's departure endpoint
  const end = Math.max(
    start,
    props.sailings.at(-1)?.projectedDepartureAt ??
      props.sailing.projectedDepartureAt
  );
  const capacitySeries = buildSailingCapacityTimeline(
    props.sailings,
    start,
    end
  );
  const lanes = buildLanes(props);
  // fill annotations belong to each independent inventory rather than the selection
  for (const series of capacitySeries) {
    const fill = lanes[2];
    // supplied fill timings remain valid even when percent-capacity lacks a denominator
    const candidates = [
      {
        label: "Estimated fill time",
        shortLabel: "Estimated fill",
        at: series.fullAt,
      },
      {
        label: "Earliest fill",
        shortLabel: "Earliest fill",
        at: series.fillRange?.earliest,
      },
      {
        label: "Latest fill",
        shortLabel: "Latest fill",
        at: series.fillRange?.latest,
      },
    ];
    // retain real bounds without inventing fill timestamps for unknown models
    for (const point of candidates) {
      // only this sailing's plotted interval owns its exhaustion annotations
      if (
        typeof point.at === "number" &&
        point.at <= series.sailing.projectedDepartureAt
      ) {
        fill.points.push({
          ...point,
          at: point.at,
          color: "fill",
          key: `${series.key}:${point.label}`,
        });
      }
    }
    // a planning fill band needs both supplied bounds
    if (
      typeof series.fillRange?.earliest === "number" &&
      typeof series.fillRange.latest === "number" &&
      Math.max(series.from, series.fillRange.earliest) <=
        Math.min(series.to, series.fillRange.latest)
    ) {
      fill.ranges.push({
        color: "fill",
        key: series.key,
        label: "Planning fill range",
        start: Math.max(series.from, series.fillRange.earliest),
        end: Math.min(series.to, series.fillRange.latest),
      });
    }
  }
  const sailingLanes = props.sailings.length
    ? props.sailings.map((sailing) => buildLanes({ ...props, sailing })[0])
    : [lanes[0]];
  // reserve every selectable caption's geometry so only the blue timeline changes
  const layoutLanes = [...sailingLanes, lanes[2]];
  const points = layoutLanes.flatMap((lane) => lane.points);
  const hasProjection = capacitySeries.some((series) => series.mean.length > 0);
  const crossDay =
    DateTime.fromSeconds(
      Math.min(start, props.arrivalAt, ...points.map((point) => point.at)),
      {
        zone: "America/Los_Angeles",
      }
    ).toISODate() !==
    DateTime.fromSeconds(
      Math.max(end, props.arrivalAt, ...points.map((point) => point.at)),
      {
        zone: "America/Los_Angeles",
      }
    ).toISODate();
  // distinguish calendar days when annotations cross midnight
  const time = (at: number): string =>
    DateTime.fromSeconds(at, { zone: "America/Los_Angeles" }).toFormat(
      crossDay ? "MMM d · h:mm a" : "h:mm a"
    );
  // arrows distinguish off-window times from exact points inside the requested axis
  const caption = (point: Point): string =>
    `${point.at < start ? "← " : ""}${point.shortLabel} · ${time(point.at)}${point.at > end ? " →" : ""}`;
  const captions = [...new Set(points.map(caption))];
  const captionsKey = captions.join("|");
  // align the zero-percent baseline with real rotated text bounds after fonts load
  useEffect(() => {
    const element = scroll.current;
    // skip measurements without a mounted timeline
    if (!element) {
      return;
    }
    // collect unrotated font metrics without feeding layout positions back into state
    const measure = (): void => {
      const measured: LabelMetrics = {};
      // measure each caption's font width and descent
      for (const label of element.querySelectorAll<SVGTextElement>(
        "[data-label-measurement]"
      )) {
        // non-layout test environments retain the conservative initial metrics
        if (typeof label.getBBox !== "function") {
          continue;
        }
        const bounds = label.getBBox();
        measured[label.textContent ?? ""] = {
          width: bounds.width,
          descent:
            Math.round(
              (bounds.y + bounds.height - Number(label.getAttribute("y"))) *
                1000
            ) / 1000,
        };
      }
      // avoid a render when font geometry is unchanged
      setLabelMetrics((previous) =>
        Object.entries(measured).every(
          ([text, value]) =>
            previous[text]?.width === value.width &&
            previous[text]?.descent === value.descent
        )
          ? previous
          : measured
      );
    };
    measure();
    document.fonts?.addEventListener("loadingdone", measure);
    // release font observation when captions change or details close
    return () => document.fonts?.removeEventListener("loadingdone", measure);
  }, [captionsKey]);
  // reserve only the width needed to keep a horizontal caption bank inside the svg
  const minimumWidth = Math.ceil(
    Math.max(
      0,
      ...layoutLanes.flatMap((lane) =>
        [false, true].flatMap((ascending) =>
          [...lane.points]
            .sort((a, b) => (ascending ? a.at - b.at : b.at - a.at))
            .map(
              (point, index) =>
                (labelMetrics[caption(point)]?.width ??
                  caption(point).length * 7) *
                  Math.SQRT1_2 +
                12 +
                index * LABEL_SPACING +
                LABEL_LEFT_PADDING +
                8
            )
        )
      )
    )
  );
  const width = Math.max(availableWidth, minimumWidth);
  const left = 4;
  const right = width - 8;
  // clamp off-window annotations while retaining their actual timestamps and arrow labels
  const position = (at: number): number =>
    left +
    Math.max(0, Math.min(1, (at - start) / Math.max(1, end - start))) *
      (right - left);
  // align with the latest marker while keeping a clipped lane's heading inside the svg
  const headingX = (lane: Lane): number =>
    Math.max(
      position(Math.max(...lane.points.map((point) => point.at))),
      (labelMetrics[lane.label]?.width ?? lane.label.length * 8) + left
    );
  // bound the bottom corner of each rotated caption
  const labelBottom = (label: Label): number =>
    label.y + (label.width + label.descent) * Math.SQRT1_2;
  // reserve only the actual annotation height before the following timeline
  const bottom = (labels: Label[], fallback: number): number =>
    Math.max(fallback, ...labels.map((label) => labelBottom(label) + 8));
  const sailingY = 26;
  const labelRight = right;
  const sailingLabels = placeLabels(
    lanes[0].points,
    sailingY,
    position,
    caption,
    labelMetrics,
    labelRight,
    true
  );
  const reservedSailingBottom = Math.max(
    ...sailingLanes.map((lane) =>
      bottom(
        placeLabels(
          lane.points,
          sailingY,
          position,
          caption,
          labelMetrics,
          labelRight,
          true
        ),
        sailingY + 18
      )
    )
  );
  const graphY = sailingY;
  // reserve every blue caption above the centered vertical arrival label
  const graphHeight = Math.max(
    180,
    Math.ceil(2 * (reservedSailingBottom - graphY + 24))
  );
  const graphBottom = graphY + graphHeight;
  const arrivalX = position(props.arrivalAt);
  const arrivalCaptionX = arrivalX < left + 20 ? arrivalX + 16 : arrivalX - 6;
  const arrivalCaptionY = (graphY + graphBottom) / 2;
  const cutoffAt =
    props.sailing.projectedDepartureAt - props.sailing.operatorCutoffSeconds;
  const fillLabels = placeLabels(
    lanes[2].points,
    graphBottom + 24,
    position,
    caption,
    labelMetrics
  );
  const height = Math.ceil(bottom(fillLabels, graphBottom + 30)) + 12;
  // keep all percentages within the graph's physical 0–100 scale
  const percentY = (percent: number): number =>
    graphBottom - (percent * graphHeight) / 100;
  // describe each sampled path using the shared time and percentage axes
  const path = (values: { at: number; percent: number }[]): string =>
    values
      .map(
        (value, index) =>
          `${index === 0 ? "M" : "L"} ${position(value.at)} ${percentY(value.percent)}`
      )
      .join(" ");
  // preserve exact off-window times in the accessible explanation
  const pointDescription = (point: Point): string => {
    const before = point.at < start ? " (before now)" : "";
    const after = point.at > end ? " (after chart)" : "";
    return `${point.label}: ${time(point.at)}${before}${after}`;
  };
  const description = `Sailing: ${props.sailing.vesselName}. Now ${time(start)} to ${time(end)}. 0% capacity taken, 100% unavailable to drive-up. ${lanes.map((lane) => `${lane.label}. ${lane.points.map(pointDescription).join(". ")}. ${lane.ranges.map((range) => `${range.label}: ${time(range.start)} to ${time(range.end)}`).join(". ")}`).join(". ")} ${hasProjection ? "Estimated drive-up capacity used from live observations and fill-model rates, including space allocated away from drive-up and ending each inventory at its own departure. A measurable preceding model supplies departure reset and estimated excess-demand carryover. Otherwise each sailing retains its own direct live occupancy rather than inventing a reset. Carryover is estimated, not observed." : "Capacity projection unavailable."} ${capacitySeries.map((series) => `${series.sailing.vesselName}: ${time(series.to)}. ${CAPACITY_DESCRIPTIONS[series.modelBasis]} ${series.fullAt === null ? "Estimated fill time unknown." : `Estimated fill: ${time(series.fullAt)}.`} ${series.fillRange?.earliest === null ? "Earliest fill time unknown." : ""} ${series.fillRange?.latest === null ? "Latest fill time unknown." : ""}`).join(" ")}`;

  // retain exact marker coordinates while captions make horizontal room
  const renderPoints = (labels: Label[], y: number): React.ReactNode =>
    labels.map((label) => {
      const { point, x } = label;
      const clipped = point.at < start || point.at > end;
      return (
        <g className={COLORS[point.color]} key={point.key ?? point.label}>
          <circle
            cx={position(point.at)}
            cy={y}
            data-clipped={clipped ? "true" : undefined}
            data-point-key={point.key ?? point.label}
            data-time={point.at}
            data-timeline-point={point.label}
            fill={clipped ? "none" : "currentColor"}
            r={3.5}
            stroke="currentColor"
          >
            <title>{pointDescription(point)}</title>
          </circle>
          <text
            data-point-key={point.key ?? point.label}
            data-label-x={x}
            data-timeline-label={point.label}
            fill="currentColor"
            fontSize={11}
            textAnchor={label.flipped ? "start" : "end"}
            transform={`rotate(${label.flipped ? 45 : -45} ${x} ${label.y})`}
            x={x}
            y={label.y}
          >
            {label.text}
          </text>
        </g>
      );
    });
  // clip visual intervals to the requested window without changing their actual bounds
  const renderRanges = (
    lane: Lane,
    y: number,
    fullHeight = false
  ): React.ReactNode =>
    lane.ranges.map((range, index) => {
      const x = position(Math.min(range.start, range.end));
      const last = position(Math.max(range.start, range.end));
      return (
        <rect
          className={COLORS[range.color]}
          data-end={range.end}
          data-start={range.start}
          data-timeline-range={range.label}
          fill="currentColor"
          fillOpacity={fullHeight ? 0.08 : 0.28}
          height={fullHeight ? graphHeight : 8}
          key={range.key ?? range.label}
          rx={fullHeight ? 0 : 4}
          width={Math.max(1, last - x)}
          x={x}
          y={fullHeight ? graphY : y - 4 + index * 10}
        >
          <title>{`${range.label}: ${time(range.start)}–${time(range.end)}`}</title>
        </rect>
      );
    });

  return (
    <figure aria-label="Trip timing timeline" className="mt-4 min-w-0">
      <div
        aria-label="Scrollable trip timing timeline"
        className="max-w-full overflow-x-auto rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-dark dark:focus-visible:ring-green-light"
        ref={scroll}
        role="region"
        tabIndex={0}
      >
        <svg
          aria-labelledby={`${id}-title ${id}-description`}
          className="block max-w-none text-gray-dark dark:text-gray-light"
          data-domain-end={end}
          data-domain-start={start}
          data-graph-bottom={graphBottom}
          data-graph-top={graphY}
          fill="currentColor"
          height={height}
          role="img"
          width={width}
        >
          <title id={`${id}-title`}>Trip timing timeline</title>
          <desc id={`${id}-description`}>{description}</desc>
          <g aria-hidden="true" visibility="hidden">
            {captions.map((text) => (
              // measure every selectable caption before reserving the shared frame
              <text data-label-measurement fontSize={11} key={text} x={0} y={0}>
                {text}
              </text>
            ))}
            {["Sailing"].map((text) => (
              // headings retain their heavier font metrics independently
              <text
                data-label-measurement
                fontSize={12}
                fontWeight={600}
                key={text}
                x={0}
                y={0}
              >
                {text}
              </text>
            ))}
          </g>
          {(right - left < 240 ? [0, 1] : [0, 0.5, 1]).map((fraction) => {
            // share identical now-to-latest time coordinates across every visual layer
            const at = start + fraction * (end - start);
            const x = position(at);
            return (
              <g aria-hidden="true" key={fraction}>
                <line
                  opacity={0.12}
                  stroke="currentColor"
                  x1={x}
                  x2={x}
                  y1={sailingY}
                  y2={graphBottom}
                />
              </g>
            );
          })}
          <g data-capacity-background>
            {[0, 25, 50, 75, 100].map((percent) => {
              // retain the inferred zero-to-full capacity grid without numeric captions
              const y = percentY(percent);
              return (
                <line
                  data-capacity-grid={percent}
                  key={percent}
                  opacity={0.12}
                  stroke="currentColor"
                  x1={left}
                  x2={right}
                  y1={y}
                  y2={y}
                />
              );
            })}
            {renderRanges(lanes[2], graphBottom, true)}
            {capacitySeries.map((series, index) => {
              // unknown inventories keep their stable series index without an invented area
              if (series.mean.length === 0) {
                return null;
              }
              // each area ends at its own departure and starts with its own observed inventory
              const fullAt =
                typeof series.fullAt === "number" && series.fullAt < series.to
                  ? series.fullAt
                  : null;
              const conservativeAt =
                typeof series.fillRange?.earliest === "number" &&
                series.fillRange?.earliest <= series.to
                  ? series.fillRange?.earliest
                  : null;
              return (
                <g
                  className={COLORS.fill}
                  data-capacity-sailing={series.key}
                  data-capacity-index={index}
                  data-model-basis={series.modelBasis}
                  data-from={series.from}
                  data-to={series.to}
                  data-departure-at={series.sailing.projectedDepartureAt}
                  data-full-at={series.fullAt ?? undefined}
                  data-conservative-at={series.fillRange?.earliest ?? undefined}
                  key={series.key}
                >
                  <title>{`Sailing: ${series.sailing.vesselName} · ${time(series.to)}`}</title>
                  <path
                    d={`${path(series.high)} ${path([...series.low].reverse()).replace(/^M/, "L")} Z`}
                    data-capacity-envelope
                    fill="currentColor"
                    fillOpacity={0.1}
                  />
                  <path
                    d={`${path(series.mean)} L ${position(series.to)} ${graphBottom} L ${position(series.from)} ${graphBottom} Z`}
                    data-capacity-area
                    fill="currentColor"
                    fillOpacity={index % 2 ? 0.16 : 0.12}
                  />
                  {fullAt !== null && (
                    <rect
                      data-full-capacity-region
                      data-time={fullAt}
                      fill="currentColor"
                      fillOpacity={0.2}
                      height={graphHeight}
                      width={
                        position(series.to) -
                        position(Math.max(series.from, fullAt))
                      }
                      x={position(Math.max(series.from, fullAt))}
                      y={graphY}
                    >
                      <title>{`After estimated fill: ${time(fullAt)} · ${series.sailing.vesselName}`}</title>
                    </rect>
                  )}
                  <path
                    d={path(series.mean)}
                    data-capacity-curve
                    data-samples={JSON.stringify(series.mean)}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity={0.65}
                    strokeWidth={2}
                  />
                  {conservativeAt !== null && (
                    <line
                      data-clipped={
                        conservativeAt < series.from ? "true" : undefined
                      }
                      data-conservative-fill
                      data-time={conservativeAt}
                      stroke="currentColor"
                      strokeDasharray="1 5"
                      strokeLinecap="round"
                      strokeWidth={2}
                      x1={position(Math.max(series.from, conservativeAt))}
                      x2={position(Math.max(series.from, conservativeAt))}
                      y1={graphY}
                      y2={graphBottom}
                    >
                      <title>{`Conservative full estimate — earliest modeled fill: ${time(conservativeAt)} · ${series.sailing.vesselName}`}</title>
                    </line>
                  )}
                  {index > 0 && (
                    <line
                      data-capacity-separator
                      stroke="currentColor"
                      strokeDasharray="3 4"
                      strokeOpacity={0.4}
                      x1={position(series.from)}
                      x2={position(series.from)}
                      y1={graphY}
                      y2={graphBottom}
                    />
                  )}
                </g>
              );
            })}
          </g>
          <line
            className={COLORS.sailing}
            data-cutoff-marker
            data-time={cutoffAt}
            data-clipped={
              cutoffAt < start || cutoffAt > end ? "true" : undefined
            }
            stroke="currentColor"
            strokeDasharray="1 5"
            strokeLinecap="round"
            strokeWidth={2}
            x1={position(cutoffAt)}
            x2={position(cutoffAt)}
            y1={graphY}
            y2={graphBottom}
          >
            <title>
              {pointDescription({
                at: cutoffAt,
                color: "sailing",
                label: "Boarding cutoff",
                shortLabel: "Cutoff",
              })}
            </title>
          </line>
          <g className={COLORS.sailing} data-timeline-lane="sailing">
            <text
              data-lane-caption
              fontSize={12}
              fontWeight={600}
              textAnchor="end"
              x={headingX(lanes[0])}
              y={sailingY - 8}
            >
              Sailing
            </text>
            <line
              opacity={0.6}
              stroke="currentColor"
              x1={left}
              x2={right}
              y1={sailingY}
              y2={sailingY}
            />
            {renderRanges(lanes[0], sailingY)}
            {renderPoints(sailingLabels, sailingY)}
          </g>
          <g className={arrivalColorClassName} data-timeline-lane="arrival">
            <line
              className={arrivalColorClassName}
              data-arrival-marker
              data-time={props.arrivalAt}
              data-clipped={
                props.arrivalAt < start || props.arrivalAt > end
                  ? "true"
                  : undefined
              }
              stroke="currentColor"
              strokeDasharray="1 5"
              strokeLinecap="round"
              strokeWidth={2}
              x1={arrivalX}
              x2={arrivalX}
              y1={graphY}
              y2={graphBottom}
            >
              <title>
                {pointDescription({
                  at: props.arrivalAt,
                  color: "you",
                  label: "Estimated arrival",
                  shortLabel: "ETA",
                })}
              </title>
            </line>
            <text
              data-arrival-caption
              fill="currentColor"
              fontSize={11}
              fontWeight={600}
              textAnchor="middle"
              transform={`rotate(-90 ${arrivalCaptionX} ${arrivalCaptionY})`}
              x={arrivalCaptionX}
              y={arrivalCaptionY}
            >
              {`${props.arrivalAt < start ? "← " : ""}ETA${props.arrivalAt > end ? " →" : ""}`}
            </text>
          </g>
          <g data-timeline-lane="capacity">
            {hasProjection && (
              <text
                className={COLORS.fill}
                data-capacity-caption
                fontSize={11}
                fontWeight={600}
                textAnchor="end"
                x={right}
                y={graphBottom - 4}
              >
                Capacity
              </text>
            )}
            <line
              data-time-axis
              opacity={0.3}
              stroke="currentColor"
              x1={left}
              x2={right}
              y1={graphBottom}
              y2={graphBottom}
            />
            {(right - left < 240 ? [0, 1] : [0, 0.5, 1]).map((fraction) => {
              // place clock captions beneath the full-width horizontal axis
              const at = start + fraction * (end - start);
              const edgeAnchor = fraction === 0 ? "start" : "end";
              const anchor = fraction === 0.5 ? "middle" : edgeAnchor;
              return (
                <text
                  data-axis-label="time"
                  fontSize={10}
                  key={fraction}
                  textAnchor={anchor}
                  x={position(at) + (fraction === 0 ? 5 : 0)}
                  y={graphBottom + 16}
                >
                  {fraction === 0
                    ? "Now"
                    : DateTime.fromSeconds(at, {
                        zone: "America/Los_Angeles",
                      }).toFormat("h:mm a")}
                </text>
              );
            })}
            {renderPoints(fillLabels, graphBottom)}
          </g>
        </svg>
      </div>
    </figure>
  );
};
