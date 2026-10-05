/* global PopStateEvent, URL, URLSearchParams, console, document, process, window */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const baseUrl = process.env.SAILING_FIXTURE_URL ?? "http://127.0.0.1:55768/";
const evidenceDirectory = path.resolve(
  process.env.SAILING_EVIDENCE_DIRECTORY ??
    ".omx/evidence/sailing-capacity-chart-browser"
);
const layoutEvidence = [];
const results = [];
const skeletonLayoutEvidence = [];
const timelineEvidence = [];
const baseTimelinePoints = ["Boarding cutoff", "Estimated departure"];
const liveCapacityTimelinePoints = ["Earliest fill", "Estimated fill time"];

// run one isolated browser scenario with console and network capture
const runScenario = async (browser, options, exercise) => {
  const context = await browser.newContext({
    colorScheme: options.colorScheme ?? "light",
    viewport: options.viewport,
  });
  // seed only explicitly requested non-sensitive fixture preferences
  if (options.initialStorage) {
    await context.addInitScript((storage) => {
      // restore each requested preference before react initializes
      for (const [key, value] of Object.entries(storage)) {
        window.localStorage.setItem(key, value);
      }
    }, options.initialStorage);
  }
  const page = await context.newPage();
  // freeze requested scenario time and timers before the app creates either
  if (options.fixedTime) {
    const fixedTime = new Date(options.fixedTime);
    await page.clock.install({ time: new Date(fixedTime.getTime() - 60_000) });
    await page.clock.pauseAt(fixedTime);
  }
  page.setDefaultTimeout(5_000);
  const consoleErrors = [];
  const requests = [];
  // retain only browser errors for the acceptance report
  page.on("console", (message) => {
    // record actionable console output
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  // record request method and host without request bodies
  page.on("request", (request) => {
    requests.push({ method: request.method(), url: request.url() });
  });
  const url = new URL(baseUrl);
  url.searchParams.set("scenario", options.scenario);
  // add requested public control fields without replacing the fixture scenario
  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    url.searchParams.set(key, value);
  }
  // retain one exact initial private fragment when requested
  if (options.hash) {
    url.hash = options.hash;
  }
  // activate the production class-based dark theme when requested
  if (options.colorScheme === "dark") {
    url.searchParams.set("theme", "dark");
  }
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "What boat will I make?" }).waitFor();
  const initialAudit = await page.evaluate(() => window.__sailingFixture);
  assert.equal(initialAudit.apiCalls, 0);
  assert.equal(initialAudit.locationRequests, 0);
  assert.equal(initialAudit.shareCalls, 0);
  try {
    await exercise(page);
  } catch (error) {
    // let diagnostic screenshots settle when a controlled-clock scenario fails
    if (options.fixedTime) {
      await page.clock.resume();
    }
    // retain the failing rendered geometry before closing chromium
    await page.screenshot({
      fullPage: true,
      path: path.join(evidenceDirectory, `failed-${options.name}.png`),
    });
    throw error;
  }
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDirectory, `${options.name}.png`),
  });
  const finalAudit = await page.evaluate(() => window.__sailingFixture);
  const storage = await page.evaluate(() => ({ ...window.localStorage }));
  const currentUrl = page.url();
  const body = await page.locator("body").innerText();
  const externalRequests = requests.filter(
    (request) => new URL(request.url).origin !== new URL(baseUrl).origin
  );
  const fragmentRequests = requests.filter(
    // private fragments must never enter any page request
    (request) =>
      request.method === "GET" &&
      (request.url.includes("#") || request.url.includes("tripAddress"))
  );
  const postRequests = requests.filter((request) => request.method === "POST");
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(fragmentRequests, []);
  assert.deepEqual(postRequests, []);
  results.push({
    body,
    consoleErrors,
    currentUrl,
    externalRequests,
    finalAudit,
    fragmentRequests,
    initialAudit,
    name: options.name,
    postRequests,
    requestCount: requests.length,
    requests,
    storage,
    viewport: options.viewport,
  });
  await context.close();
};

// submit one fixture route through the production foreground-location control
const requestEstimate = async (page) => {
  await page.getByRole("button", { name: "Use my location" }).click();
  await page.getByText("Estimated terminal arrival", { exact: true }).waitFor();
};

// resolve the prominent arrival time within its dedicated result block
const arrivalTime = (page) =>
  page
    .getByText("Estimated terminal arrival", { exact: true })
    .locator("xpath=following-sibling::p[1]");

// require the accessible result-shaped loading region without visible loading copy
const assertLoadingSkeleton = async (page) => {
  const skeleton = page.getByLabel("Estimating your trip", { exact: true });
  await skeleton.waitFor();
  assert.equal(await skeleton.getAttribute("aria-busy"), "true");
  assert.ok((await skeleton.locator(".skeleton").count()) > 10);
  const headerShapes = skeleton
    .locator(":scope > div")
    .first()
    .locator(".skeleton");
  const [arrivalBox, shareBox] = await Promise.all([
    headerShapes.nth(1).boundingBox(),
    headerShapes.nth(2).boundingBox(),
  ]);
  assert.ok(arrivalBox);
  assert.ok(shareBox);
  const verticalOffset = Math.abs(
    arrivalBox.y + arrivalBox.height / 2 - (shareBox.y + shareBox.height / 2)
  );
  const overlapsArrival = !(
    arrivalBox.x + arrivalBox.width <= shareBox.x ||
    shareBox.x + shareBox.width <= arrivalBox.x
  );
  skeletonLayoutEvidence.push({
    arrivalBox,
    overlapsArrival,
    shareBox,
    verticalOffset,
    viewport: page.viewportSize(),
  });
  assert.ok(verticalOffset <= 1);
  assert.equal(overlapsArrival, false);
  assert.equal(
    await page.getByText("Estimating your trip…", { exact: true }).count(),
    0
  );
  assert.equal(await page.getByLabel("Sailing estimates").count(), 0);
};

// keep the share action visually over the later column without page overflow
const assertSharePlacement = async (page) => {
  const share = page.getByRole("button", { name: "Share trip" });
  const grid = page.getByLabel("Sailing estimates");
  const later = grid.locator(":scope > button").nth(2);
  const [shareBox, arrivalBox, gridBox, laterBox] = await Promise.all([
    share.boundingBox(),
    arrivalTime(page).boundingBox(),
    grid.boundingBox(),
    later.boundingBox(),
  ]);
  assert.ok(shareBox);
  assert.ok(arrivalBox);
  assert.ok(gridBox);
  assert.ok(laterBox);
  const horizontalOffset = Math.abs(
    shareBox.x + shareBox.width / 2 - (laterBox.x + laterBox.width / 2)
  );
  const verticalOffset = Math.abs(
    shareBox.y + shareBox.height / 2 - (arrivalBox.y + arrivalBox.height / 2)
  );
  const overlapsArrival = !(
    arrivalBox.x + arrivalBox.width <= shareBox.x ||
    shareBox.x + shareBox.width <= arrivalBox.x
  );
  const sailingTimeBoxes = await Promise.all(
    [0, 1, 2].map((index) =>
      grid
        .locator(":scope > button")
        .nth(index)
        .locator("[data-sailing-time]")
        .boundingBox()
    )
  );
  assert.ok(sailingTimeBoxes.every(Boolean));
  const sailingTimeGaps = sailingTimeBoxes.slice(0, -1).map(
    // preserve positive space between adjacent sailing-time labels
    (box, index) => sailingTimeBoxes[index + 1].x - (box.x + box.width)
  );
  layoutEvidence.push({
    arrivalBox,
    horizontalOffset,
    laterBox,
    overlapsArrival,
    shareBox,
    sailingTimeGaps,
    url: page.url(),
    verticalOffset,
    viewport: page.viewportSize(),
  });
  assert.ok(
    horizontalOffset <= 1 && verticalOffset <= 1,
    `share center offsets: horizontal=${horizontalOffset}px vertical=${verticalOffset}px`
  );
  assert.equal(overlapsArrival, false);
  assert.ok(sailingTimeGaps.every((gap) => gap >= 0));
  assert.ok(shareBox.x + shareBox.width <= gridBox.x + gridBox.width + 1);
  assert.equal(await share.locator("svg").count(), 1);
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
    ),
    true
  );
};

// require the three chronological result columns and their names
const assertSailingTrio = async (page, names) => {
  const grid = page.getByLabel("Sailing estimates");
  assert.equal(await grid.locator(":scope > button").count(), 3);
  await grid.getByText("Earlier", { exact: true }).waitFor();
  await grid.getByText("Estimated", { exact: true }).waitFor();
  await grid.getByText("Later", { exact: true }).waitFor();
  // match time and chance colors without adding separate chance buttons
  for (const column of await grid.locator(":scope > button").all()) {
    const chance = column.locator("[data-sailing-chance]");
    const percent = parseFloat((await chance.innerText()).replace(/[<>]/g, ""));
    const color =
      percent <= 30
        ? "text-red-700"
        : percent < 70
          ? "text-orange-700"
          : "text-green-dark";
    assert.match(
      await column.locator("[data-sailing-time]").getAttribute("class"),
      new RegExp(color)
    );
    assert.match(await chance.getAttribute("class"), new RegExp(color));
    assert.equal(await column.locator("svg").count(), 0);
  }
  // prove each requested chronological context is rendered
  for (const name of names) {
    await grid.getByText(name, { exact: true }).waitFor();
  }
};

// validate the accessible shared-scale timeline and its rendered svg geometry
const assertTimeline = async (page, options = {}) => {
  const details = page.locator("#sailing-chance-details");
  const figure = details.locator('figure[aria-label="Trip timing timeline"]');
  await figure.waitFor();
  // allow loaded font metrics to settle before testing the exact label-bottom baseline
  await figure.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
    });
  });
  const region = figure.getByRole("region", {
    name: "Scrollable trip timing timeline",
  });
  const svg = figure.locator('svg[role="img"]');
  assert.equal(await region.count(), 1);
  assert.equal(await svg.count(), 1);
  // compare computed svg paint with the prominent eta time in the active theme
  const arrivalColor = await arrivalTime(page).evaluate(
    (time) => window.getComputedStyle(time).color
  );
  const evidence = await figure.evaluate((element) => {
    const svgElement = element.querySelector("svg");
    const regionElement = element.querySelector('[role="region"]');
    // project an actual svg text box through its rotation matrix
    const textPolygon = (text) => {
      const bounds = text.getBBox();
      const matrix = text.getScreenCTM();
      assertMatrix(matrix);
      return [
        [bounds.x, bounds.y],
        [bounds.x + bounds.width, bounds.y],
        [bounds.x + bounds.width, bounds.y + bounds.height],
        [bounds.x, bounds.y + bounds.height],
      ].map(([x, y]) => ({
        x: matrix.a * x + matrix.c * y + matrix.e,
        y: matrix.b * x + matrix.d * y + matrix.f,
      }));
    };
    // fail explicitly if chromium cannot expose svg geometry
    const assertMatrix = (matrix) => {
      if (!matrix) {
        throw new Error("missing svg text transform matrix");
      }
    };
    // project one polygon onto a separating axis
    const projection = (polygon, axis) =>
      polygon.map((point) => point.x * axis.x + point.y * axis.y);
    // use separating axes so rotated labels are not reduced to false aabb hits
    const polygonsOverlap = (first, second) => {
      for (const polygon of [first, second]) {
        for (let index = 0; index < polygon.length; index += 1) {
          const current = polygon[index];
          const next = polygon[(index + 1) % polygon.length];
          const axis = {
            x: -(next.y - current.y),
            y: next.x - current.x,
          };
          const firstProjection = projection(first, axis);
          const secondProjection = projection(second, axis);
          if (
            Math.max(...firstProjection) <= Math.min(...secondProjection) ||
            Math.max(...secondProjection) <= Math.min(...firstProjection)
          ) {
            return false;
          }
        }
      }
      return true;
    };
    // retain each supplied marker and its accessible exact time
    const points = Array.from(
      element.querySelectorAll("[data-timeline-point]")
    ).map((point) => ({
      key: point.getAttribute("data-point-key"),
      cx: Number(point.getAttribute("cx")),
      cy: Number(point.getAttribute("cy")),
      clipped: point.getAttribute("data-clipped") === "true",
      lane: point
        .closest("[data-timeline-lane]")
        ?.getAttribute("data-timeline-lane"),
      name: point.getAttribute("data-timeline-point"),
      time: Number(point.getAttribute("data-time")),
      title: point.querySelector("title")?.textContent?.trim() ?? "",
    }));
    // retain the real interval endpoints without interpreting missing bounds
    const ranges = Array.from(
      element.querySelectorAll("[data-timeline-range]")
    ).map((range) => ({
      className: range.getAttribute("class") ?? "",
      end: Number(range.getAttribute("data-end")),
      name: range.getAttribute("data-timeline-range"),
      start: Number(range.getAttribute("data-start")),
      title: range.querySelector("title")?.textContent?.trim() ?? "",
      width: Number(range.getAttribute("width")),
    }));
    // inspect transformed text bounds rather than label anchor approximations
    const labels = Array.from(
      element.querySelectorAll("text[data-timeline-label]")
    ).map((label) => ({
      lane: label
        .closest("[data-timeline-lane]")
        ?.getAttribute("data-timeline-lane"),
      key: label.getAttribute("data-point-key"),
      name: label.getAttribute("data-timeline-label"),
      x: Number(label.getAttribute("x")),
      y: Number(label.getAttribute("y")),
      anchor: label.getAttribute("text-anchor"),
      width: label.getBBox().width,
      spans: label.querySelectorAll("tspan").length,
      polygon: textPolygon(label),
      transform: label.getAttribute("transform"),
    }));
    const collisions = [];
    // compare labels only within their own horizontal track
    for (let first = 0; first < labels.length; first += 1) {
      for (let second = first + 1; second < labels.length; second += 1) {
        if (
          labels[first].lane === labels[second].lane &&
          polygonsOverlap(labels[first].polygon, labels[second].polygon)
        ) {
          collisions.push([labels[first].name, labels[second].name]);
        }
      }
    }
    const svgTexts = Array.from(
      svgElement.querySelectorAll("text:not([data-label-measurement])")
    ).map((text, index) => ({
      name:
        text.getAttribute("data-timeline-label") ??
        text.textContent?.trim().replace(/\s+/gu, " ") ??
        `text-${index}`,
      polygon: textPolygon(text),
    }));
    const svgTextCollisions = [];
    // keep marker labels clear of lane captions and the shared axis as well
    for (let first = 0; first < svgTexts.length; first += 1) {
      for (let second = first + 1; second < svgTexts.length; second += 1) {
        if (
          polygonsOverlap(svgTexts[first].polygon, svgTexts[second].polygon)
        ) {
          svgTextCollisions.push([svgTexts[first].name, svgTexts[second].name]);
        }
      }
    }
    const svgBounds = svgElement.getBoundingClientRect();
    const clippedLabels = labels
      .filter((label) =>
        label.polygon.some(
          (point) =>
            point.x < svgBounds.left - 0.5 ||
            point.x > svgBounds.right + 0.5 ||
            point.y < svgBounds.top - 0.5 ||
            point.y > svgBounds.bottom + 0.5
        )
      )
      .map((label) => label.name);
    const clippedSvgTexts = svgTexts
      .filter((text) =>
        text.polygon.some(
          (point) =>
            point.x < svgBounds.left - 0.5 ||
            point.x > svgBounds.right + 0.5 ||
            point.y < svgBounds.top - 0.5 ||
            point.y > svgBounds.bottom + 0.5
        )
      )
      .map((text) => text.name);
    const labelledBy = (svgElement.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/u)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .join(" ");
    const axis = svgElement.querySelector("[data-time-axis]");
    const matrix = svgElement.getScreenCTM();
    const graphTop = Number(svgElement.getAttribute("data-graph-top"));
    const graphBottom = Number(svgElement.getAttribute("data-graph-bottom"));
    // check axis text against the actual graph rectangle rather than the whole svg
    const outsideGraph = Array.from(
      svgElement.querySelectorAll('[data-axis-label="capacity"]')
    )
      .filter((label) =>
        textPolygon(label).some(
          (point) =>
            point.x < svgBounds.left - 0.5 ||
            point.x > svgBounds.right + 0.5 ||
            point.y < matrix.d * graphTop + matrix.f - 0.5 ||
            point.y > matrix.d * graphBottom + matrix.f + 0.5
        )
      )
      .map((label) => label.textContent);
    const graphBottomScreen = matrix.d * graphBottom + matrix.f;
    const background = svgElement.querySelector("[data-capacity-background]");
    const sailingLane = svgElement.querySelector(
      '[data-timeline-lane="sailing"]'
    );
    const clockAboveAxis = Array.from(
      svgElement.querySelectorAll('[data-axis-label="time"]')
    ).some((label) =>
      textPolygon(label).some((point) => point.y <= graphBottomScreen)
    );
    // compare each lane's computed color and right-aligned heading to its own markers
    const laneStyles = ["sailing"].map((id) => {
      const lane = svgElement.querySelector(`[data-timeline-lane="${id}"]`);
      const heading = lane.querySelector("[data-lane-caption]");
      return {
        id,
        className: lane.getAttribute("class"),
        color: window.getComputedStyle(lane).color,
        fills: Array.from(
          lane.querySelectorAll('text, circle:not([data-clipped="true"])')
        ).map((child) => window.getComputedStyle(child).fill),
        strokes: Array.from(lane.querySelectorAll("line, circle")).map(
          (child) => window.getComputedStyle(child).stroke
        ),
        anchor: heading.getAttribute("text-anchor"),
        headingWidth: heading.getBBox().width,
        hollowFills: Array.from(
          lane.querySelectorAll('circle[data-clipped="true"]')
        ).map((circle) => window.getComputedStyle(circle).fill),
        x: Number(heading.getAttribute("x")),
        y: Number(heading.getAttribute("y")),
      };
    });
    // inspect each independent inventory rather than a selection-dependent pair
    const capacitySeries = Array.from(
      svgElement.querySelectorAll("[data-capacity-sailing]")
    ).map((area) => {
      const full = area.querySelector("[data-full-capacity-region]");
      const conservative = area.querySelector("[data-conservative-fill]");
      return {
        key: area.getAttribute("data-capacity-sailing"),
        from: Number(area.getAttribute("data-from")),
        to: Number(area.getAttribute("data-to")),
        departureAt: Number(area.getAttribute("data-departure-at")),
        fullAt: area.hasAttribute("data-full-at")
          ? Number(area.getAttribute("data-full-at"))
          : null,
        conservativeAt: area.hasAttribute("data-conservative-at")
          ? Number(area.getAttribute("data-conservative-at"))
          : null,
        curve: JSON.parse(
          area
            .querySelector("[data-capacity-curve]")
            .getAttribute("data-samples")
        ),
        hasArea: Boolean(area.querySelector("[data-capacity-area]")),
        hasEnvelope: Boolean(area.querySelector("[data-capacity-envelope]")),
        full: full
          ? {
              at: Number(full.getAttribute("data-time")),
              x: Number(full.getAttribute("x")),
              width: Number(full.getAttribute("width")),
              opacity: Number(full.getAttribute("fill-opacity")),
            }
          : null,
        conservative: conservative
          ? {
              at: Number(conservative.getAttribute("data-time")),
              x1: Number(conservative.getAttribute("x1")),
              x2: Number(conservative.getAttribute("x2")),
              y1: Number(conservative.getAttribute("y1")),
              y2: Number(conservative.getAttribute("y2")),
              dash: conservative.getAttribute("stroke-dasharray"),
            }
          : null,
      };
    });
    // vertical comparison lines share the capacity scale and retain actual off-window times
    const readMarker = (selector) => {
      const line = svgElement.querySelector(selector);
      return {
        at: Number(line.getAttribute("data-time")),
        className: line.getAttribute("class"),
        clipped: line.getAttribute("data-clipped") === "true",
        color: window.getComputedStyle(line).stroke,
        dash: line.getAttribute("stroke-dasharray"),
        title: line.querySelector("title").textContent,
        x1: Number(line.getAttribute("x1")),
        x2: Number(line.getAttribute("x2")),
        y1: Number(line.getAttribute("y1")),
        y2: Number(line.getAttribute("y2")),
      };
    };
    const etaLabel = svgElement.querySelector("[data-arrival-caption]");
    const markers = {
      arrival: readMarker("[data-arrival-marker]"),
      cutoff: readMarker("[data-cutoff-marker]"),
      eta: {
        text: etaLabel.textContent,
        x: Number(etaLabel.getAttribute("x")),
        y: Number(etaLabel.getAttribute("y")),
        anchor: etaLabel.getAttribute("text-anchor"),
        transform: etaLabel.getAttribute("transform"),
        color: window.getComputedStyle(etaLabel).fill,
      },
      arrivalHorizontalLines: svgElement.querySelectorAll(
        '[data-timeline-lane="arrival"] line:not([data-arrival-marker])'
      ).length,
      arrivalPoints: svgElement.querySelectorAll(
        '[data-timeline-lane="arrival"] [data-timeline-point], [data-timeline-lane="arrival"] [data-timeline-label]'
      ).length,
      capacityAxisLabels: svgElement.querySelectorAll(
        '[data-axis-label="capacity"]'
      ).length,
    };
    const capacityCaption = svgElement.querySelector("[data-capacity-caption]");
    // retain annotation coordinates without relying on their visual color alone
    const fullAnnotations = {
      caption: capacityCaption?.textContent ?? null,
      captionAnchor: capacityCaption?.getAttribute("text-anchor"),
      captionX: Number(capacityCaption?.getAttribute("x")),
      captionY: Number(capacityCaption?.getAttribute("y")),
    };
    // semantic groups remain without padded or painted card wrappers
    const wrappers = [
      element.closest(
        'section[aria-labelledby="sailing-recommendation-title"]'
      ),
      element.parentElement,
    ].map((wrapper) => {
      const style = window.getComputedStyle(wrapper);
      return {
        background: style.backgroundColor,
        border: style.borderTopWidth,
        padding: style.paddingLeft,
        shadow: style.boxShadow,
      };
    });
    return {
      domainStart: Number(svgElement.getAttribute("data-domain-start")),
      domainEnd: Number(svgElement.getAttribute("data-domain-end")),
      laterDeparture: Number(
        Array.from(
          document.querySelectorAll(
            '[aria-label="Sailing estimates"] > button[data-departure-at]'
          )
        )
          .at(-1)
          ?.getAttribute("data-departure-at")
      ),
      capacitySeries,
      hasAnyArea: Boolean(element.querySelector("[data-capacity-area]")),
      laneCaptions: Array.from(
        element.querySelectorAll("[data-lane-caption]")
      ).map((label) => label.textContent),
      laneStyles,
      markers,
      fullAnnotations,
      nonCurvePaths: element.querySelectorAll(
        "path:not([data-capacity-area]):not([data-capacity-envelope]):not([data-capacity-curve])"
      ).length,
      axis: {
        left: Number(axis?.getAttribute("x1")),
        right: Number(axis?.getAttribute("x2")),
        outsideGraph,
        clockAboveAxis,
      },
      graph: {
        top: graphTop,
        bottom: graphBottom,
        behindTimelines: Boolean(
          background.compareDocumentPosition(sailingLane) &
          window.Node.DOCUMENT_POSITION_FOLLOWING
        ),
        gridTop: Number(
          svgElement
            .querySelector('[data-capacity-grid="100"]')
            .getAttribute("y1")
        ),
        gridBottom: Number(
          svgElement
            .querySelector('[data-capacity-grid="0"]')
            .getAttribute("y1")
        ),
      },
      clippedLabels,
      clippedSvgTexts,
      collisions,
      description: svgElement.querySelector("desc")?.textContent?.trim() ?? "",
      documentOverflows:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      labelledBy,
      labels,
      lanes: Array.from(element.querySelectorAll("[data-timeline-lane]")).map(
        (lane) => lane.getAttribute("data-timeline-lane")
      ),
      points,
      ranges,
      region: {
        clientWidth: regionElement.clientWidth,
        scrollWidth: regionElement.scrollWidth,
      },
      svg: {
        height: svgBounds.height,
        textCount: svgTexts.length,
        width: svgBounds.width,
      },
      svgTextCollisions,
      wrappers,
    };
  });
  const expectedLanes = ["sailing", "arrival", "capacity"];
  assert.deepEqual(evidence.lanes, expectedLanes);
  assert.deepEqual(
    evidence.points
      .filter((point) => point.lane !== "capacity")
      .map((point) => point.name)
      .sort(),
    [...(options.points ?? baseTimelinePoints)]
      .filter((name) => !liveCapacityTimelinePoints.includes(name))
      .sort()
  );
  // unchanged fixture departures omit both redundant scheduled annotations
  assert.equal(
    await figure.locator('[data-timeline-point="Scheduled departure"]').count(),
    0
  );
  assert.equal(
    await figure.locator('[data-timeline-label="Scheduled departure"]').count(),
    0
  );
  assert.equal(evidence.labels.length, evidence.points.length);
  assert.deepEqual(evidence.laneCaptions, ["Sailing"]);
  // colors apply to the entire lane and headings align above the latest actual marker
  for (const lane of evidence.laneStyles) {
    assert.match(
      lane.className,
      lane.id === "sailing"
        ? /text-sky-700/u
        : /text-(green-dark|amber-700|red-700|gray-dark)/u
    );
    assert.equal(lane.anchor, "end");
    const points = evidence.points.filter((point) => point.lane === lane.id);
    assert.ok(
      Math.abs(
        lane.x -
          Math.max(lane.headingWidth + 4, ...points.map((point) => point.cx))
      ) < 0.5
    );
    assert.ok(lane.hollowFills.every((fill) => fill === "none"));
    assert.ok(lane.y < points[0].cy);
    assert.deepEqual(
      new Set([...lane.fills, ...lane.strokes]),
      new Set([lane.color])
    );
  }
  assert.equal(
    evidence.fullAnnotations.caption,
    evidence.hasAnyArea ? "Capacity" : null
  );
  // identify only an actual capacity area without crowding unknown projection states
  if (evidence.hasAnyArea) {
    assert.equal(evidence.fullAnnotations.captionAnchor, "end");
    assert.ok(evidence.fullAnnotations.captionX > evidence.svg.width - 20);
    assert.ok(evidence.fullAnnotations.captionY < evidence.graph.bottom);
  }
  assert.equal(evidence.nonCurvePaths, 0);
  // available models have separate shaded sets regardless of the selected timeline
  if (options.capacity) {
    assert.ok(evidence.capacitySeries.length > 0);
  }
  assert.equal(
    evidence.domainEnd,
    Math.max(evidence.domainStart, evidence.laterDeparture)
  );
  // project model events on the same fixed scale as the selected sailing timeline
  const position = (at) =>
    evidence.axis.left +
    Math.max(
      0,
      Math.min(
        1,
        (at - evidence.domainStart) /
          Math.max(1, evidence.domainEnd - evidence.domainStart)
      )
    ) *
      (evidence.axis.right - evidence.axis.left);
  assert.equal(evidence.markers.arrivalHorizontalLines, 0);
  assert.equal(evidence.markers.arrivalPoints, 0);
  assert.equal(evidence.markers.capacityAxisLabels, 0);
  assert.equal(evidence.markers.eta.anchor, "middle");
  assert.match(evidence.markers.eta.text, /ETA/u);
  assert.match(evidence.markers.eta.transform, /^rotate\(-90 /u);
  assert.equal(
    evidence.markers.eta.y,
    (evidence.graph.top + evidence.graph.bottom) / 2
  );
  assert.equal(evidence.markers.eta.color, evidence.markers.arrival.color);
  assert.equal(evidence.markers.arrival.color, arrivalColor);
  const selectedDeparture = evidence.points.find(
    (point) => point.name === "Estimated departure"
  );
  assert.equal(evidence.markers.cutoff.at, selectedDeparture.time - 180);
  // each marker spans the full shared graph, even when clamped to an off-window boundary
  for (const [marker, color] of [
    [
      evidence.markers.arrival,
      /text-(green-dark|amber-700|red-700|gray-dark)/u,
    ],
    [evidence.markers.cutoff, /text-sky-700/u],
  ]) {
    assert.match(marker.className, color);
    assert.equal(marker.dash, "1 5");
    assert.equal(marker.x1, marker.x2);
    assert.ok(Math.abs(marker.x1 - position(marker.at)) < 0.01);
    assert.equal(marker.y1, evidence.graph.top);
    assert.equal(marker.y2, evidence.graph.bottom);
    assert.equal(
      marker.clipped,
      marker.at < evidence.domainStart || marker.at > evidence.domainEnd
    );
    assert.ok(marker.title.length > 0);
  }
  for (const series of evidence.capacitySeries) {
    assert.equal(series.hasArea, true);
    assert.equal(series.hasEnvelope, true);
    assert.ok(series.from >= evidence.domainStart);
    assert.ok(series.to <= evidence.domainEnd);
    assert.equal(series.to, Math.min(series.departureAt, evidence.domainEnd));
    assert.equal(
      Boolean(series.full),
      series.fullAt !== null && series.fullAt < series.to
    );
    // darker exhaustion shading ends at this inventory's own departure
    if (series.full) {
      assert.equal(series.full.at, series.fullAt);
      assert.ok(
        Math.abs(
          series.full.x - position(Math.max(series.from, series.fullAt))
        ) < 0.01
      );
      assert.ok(
        Math.abs(series.full.x + series.full.width - position(series.to)) < 0.01
      );
      assert.ok(series.full.opacity > 0.12);
    }
    assert.equal(
      Boolean(series.conservative),
      series.conservativeAt !== null && series.conservativeAt <= series.to
    );
    // each conservative boundary spans the shared physical percent scale
    if (series.conservative) {
      assert.equal(series.conservative.at, series.conservativeAt);
      assert.ok(
        Math.abs(
          series.conservative.x1 -
            position(Math.max(series.from, series.conservativeAt))
        ) < 0.01
      );
      assert.equal(series.conservative.x1, series.conservative.x2);
      assert.equal(series.conservative.y1, evidence.graph.top);
      assert.equal(series.conservative.y2, evidence.graph.bottom);
      assert.ok(series.conservative.dash);
    }
    assert.equal(series.curve[0].at, series.from);
    assert.equal(series.curve.at(-1).at, series.to);
    assert.ok(
      series.curve.every(
        (sample) => sample.percent >= 0 && sample.percent <= 100
      )
    );
    // depletion samples remain monotonic only within their own sailing interval
    for (let index = 1; index < series.curve.length; index += 1) {
      assert.ok(series.curve[index].at >= series.curve[index - 1].at);
      assert.ok(series.curve[index].percent >= series.curve[index - 1].percent);
    }
  }
  // adjacent valid models meet at a boundary without connecting capacity inventories
  for (let index = 1; index < evidence.capacitySeries.length; index += 1) {
    assert.ok(
      evidence.capacitySeries[index].from >=
        evidence.capacitySeries[index - 1].to
    );
  }
  // caption banks remain level while only their horizontal anchors make room
  for (const label of evidence.labels) {
    const point = evidence.points.find((point) => point.key === label.key);
    assert.ok(["start", "end"].includes(label.anchor));
    assert.equal(label.spans, 0);
    assert.ok(label.y > point.cy);
  }
  // walk the right-to-left caption order without changing source-time markers
  for (const lane of evidence.lanes) {
    const labels = evidence.labels.filter((label) => label.lane === lane);
    assert.equal(
      new Set(labels.map((label) => label.y)).size,
      labels.length ? 1 : 0
    );
    // verify the exact left-edge trigger from the measured original caption geometry
    if (lane === "sailing") {
      const earliest = [...labels].sort(
        (a, b) =>
          evidence.points.find((point) => point.key === a.key).time -
          evidence.points.find((point) => point.key === b.key).time
      )[0];
      const marker = evidence.points.find(
        (point) => point.key === earliest.key
      );
      const shouldFlip = earliest.width * Math.SQRT1_2 + 12 > marker.cx;
      assert.equal(labels[0].anchor, shouldFlip ? "start" : "end");
    }
    for (let index = 1; index < labels.length; index += 1) {
      const direction = labels[0].anchor === "start" ? 1 : -1;
      assert.equal(labels[index].anchor, labels[0].anchor);
      assert.ok(direction * labels[index].x > direction * labels[index - 1].x);
    }
  }
  assert.ok(evidence.axis.left <= 8);
  assert.ok(evidence.axis.right >= evidence.svg.width - 8);
  assert.deepEqual(evidence.axis.outsideGraph, []);
  assert.equal(evidence.axis.clockAboveAxis, false);
  assert.equal(
    evidence.graph.top,
    evidence.points.find((point) => point.lane === "sailing").cy
  );
  assert.ok(Math.abs(evidence.graph.gridTop - evidence.graph.top) < 0.01);
  assert.ok(Math.abs(evidence.graph.gridBottom - evidence.graph.bottom) < 0.01);
  assert.equal(evidence.graph.behindTimelines, true);
  assert.deepEqual(
    evidence.wrappers,
    Array.from({ length: 2 }, () => ({
      background: "rgba(0, 0, 0, 0)",
      border: "0px",
      padding: "0px",
      shadow: "none",
    }))
  );
  assert.deepEqual(evidence.collisions, []);
  assert.deepEqual(evidence.clippedLabels, []);
  assert.deepEqual(evidence.svgTextCollisions, []);
  assert.deepEqual(evidence.clippedSvgTexts, []);
  assert.equal(evidence.documentOverflows, false);
  assert.match(evidence.labelledBy, /^Trip timing timeline /u);
  assert.ok(evidence.points.every((point) => Number.isFinite(point.time)));
  assert.ok(evidence.points.every((point) => Number.isFinite(point.cx)));
  assert.ok(evidence.points.every((point) => point.title.length > 0));
  assert.ok(
    evidence.points.every((point) => evidence.description.includes(point.title))
  );
  assert.ok(
    evidence.labels.every((label) =>
      (label.anchor === "start" ? /^rotate\(45 /u : /^rotate\(-45 /u).test(
        label.transform
      )
    )
  );
  assert.ok(
    evidence.ranges.every(
      (range) =>
        Number.isFinite(range.start) &&
        Number.isFinite(range.end) &&
        range.title.length > 0 &&
        range.width >= 1
    )
  );
  assert.equal(
    new Set(evidence.ranges.map((range) => range.className)).size,
    new Set(evidence.ranges.map((range) => range.name)).size
  );
  const chronological = [...evidence.points].sort(
    (first, second) => first.time - second.time
  );
  // prove marker positions use time order and preserve exact coincidences
  for (let index = 1; index < chronological.length; index += 1) {
    const previous = chronological[index - 1];
    const current = chronological[index];
    if (previous.time === current.time) {
      assert.ok(Math.abs(previous.cx - current.cx) <= 0.01);
    } else {
      assert.ok(previous.cx <= current.cx);
      if (!previous.clipped && !current.clipped)
        assert.ok(previous.cx < current.cx);
    }
  }
  for (const [firstName, secondName] of options.coincidentPoints ?? []) {
    const first = evidence.points.find((point) => point.name === firstName);
    const second = evidence.points.find((point) => point.name === secondName);
    assert.ok(first);
    assert.ok(second);
    assert.equal(first.time, second.time);
    assert.ok(Math.abs(first.cx - second.cx) <= 0.01);
  }
  assert.deepEqual(
    evidence.ranges
      .map((range) => range.name)
      .filter(
        (name) =>
          !["Planning fill range", "Planning arrival range"].includes(name)
      ),
    (options.ranges ?? []).filter(
      (name) =>
        !["Planning fill range", "Planning arrival range"].includes(name)
    )
  );
  if (options.unknownFill) {
    assert.match(evidence.description, /Latest fill time unknown/u);
    assert.equal(
      evidence.points.some((point) => point.name === "Latest fill"),
      false
    );
    assert.equal(
      evidence.ranges.some((range) => range.name === "Planning fill range"),
      false
    );
  }
  if (options.crossDay) {
    assert.match(evidence.description, /11:\d{2} PM/u);
    assert.match(evidence.description, /12:\d{2} AM/u);
    assert.match(evidence.description, /Oct \d+ ·/u);
  }
  // no visible title, figure caption, stats or explanatory paragraphs remain
  assert.equal(await details.locator("h3, figcaption, dl, dt, p").count(), 0);
  assert.equal(
    await page
      .getByLabel("Sailing estimates")
      .locator('[aria-expanded="true"]')
      .count(),
    1
  );
  const internallyScrollable =
    evidence.region.scrollWidth > evidence.region.clientWidth;
  // desktops need no pan and phones scroll only when annotation width requires it
  if (!options.internalScroll) {
    assert.equal(internallyScrollable, false);
  }
  assert.ok(
    evidence.region.scrollWidth <= Math.max(evidence.region.clientWidth, 420)
  );
  let rightEdgeReachable = true;
  if (options.screenshotName) {
    await page.screenshot({
      fullPage: true,
      path: path.join(
        evidenceDirectory,
        `${options.screenshotName}-scroll-left.png`
      ),
    });
  }
  if (internallyScrollable) {
    await region.evaluate((element) => {
      // expose the final marker labels inside the bounded scrolling region
      element.scrollLeft = element.scrollWidth;
    });
    rightEdgeReachable = await figure.evaluate((element) => {
      const regionElement = element.querySelector('[role="region"]');
      const regionBounds = regionElement.getBoundingClientRect();
      const labels = Array.from(
        element.querySelectorAll("text[data-timeline-label]")
      );
      const rightmost = labels.reduce((current, label) => {
        const bounds = label.getBoundingClientRect();
        return bounds.right > current.right ? bounds : current;
      }, labels[0].getBoundingClientRect());
      return (
        rightmost.right <= regionBounds.right + 0.5 &&
        rightmost.right >= regionBounds.left
      );
    });
    assert.equal(rightEdgeReachable, true);
    if (options.screenshotName) {
      await page.screenshot({
        fullPage: true,
        path: path.join(
          evidenceDirectory,
          `${options.screenshotName}-scroll-right.png`
        ),
      });
    }
  }
  timelineEvidence.push({
    ...evidence,
    internallyScrollable,
    rightEdgeReachable,
    scenario: new URL(page.url()).searchParams.get("scenario"),
    viewport: page.viewportSize(),
  });
};

await fs.rm(evidenceDirectory, { force: true, recursive: true });
await fs.mkdir(evidenceDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  // boarding chance follows the real cutoff while the buffer still recommends a safer boat
  for (const options of [
    { width: 1280, colorScheme: "light", mode: "drive" },
    { width: 375, colorScheme: "light", mode: "drive" },
    { width: 320, colorScheme: "dark", mode: "drive" },
    { width: 375, colorScheme: "light", mode: "walk" },
  ]) {
    await runScenario(
      browser,
      {
        name: `buffer-only-late-${options.mode}-${options.width}`,
        scenario: "buffer-only-late",
        viewport: { width: options.width, height: 900 },
        colorScheme: options.colorScheme,
        searchParams: { tripMode: options.mode, tripBuffer: "5" },
      },
      // exercise the real form and production chance model without another route request
      async (page) => {
        await requestEstimate(page);
        const earlier = page.getByRole("button", { name: /^Earlier:/ });
        const departureAt = await earlier.getAttribute("data-departure-at");
        assert.equal(
          await earlier.locator("[data-sailing-chance]").innerText(),
          ">95%"
        );
        assert.match(
          await earlier.locator("[data-sailing-time]").getAttribute("class"),
          /text-green-dark/u
        );
        assert.equal(
          await page
            .getByRole("button", { name: /^Estimated:/ })
            .locator("[data-sailing-vessel]")
            .innerText(),
          "MV Estimated Fixture"
        );
        await earlier.click();
        await assertTimeline(page, {
          capacity: options.mode === "drive",
          internalScroll: options.width < 400,
          screenshotName: `timeline-buffer-only-${options.mode}-${options.width}`,
        });
        const arrivalAt = Number(
          await page.locator("[data-arrival-marker]").getAttribute("data-time")
        );
        const cutoffAt = Number(
          await page.locator("[data-cutoff-marker]").getAttribute("data-time")
        );
        assert.equal(cutoffAt - arrivalAt, 180);
        assert.ok(arrivalAt + 5 * 60 > cutoffAt);
        await page.getByLabel("Safety buffer (minutes)").fill("0");
        const affected = page.locator(
          `button[data-departure-at="${departureAt}"]`
        );
        assert.equal(
          await affected.locator("[data-sailing-label]").innerText(),
          "Estimated"
        );
        assert.equal(
          await affected.locator("[data-sailing-chance]").innerText(),
          ">95%"
        );
        await page.getByLabel("Safety buffer (minutes)").fill("10");
        assert.equal(
          await affected.locator("[data-sailing-chance]").innerText(),
          ">95%"
        );
        assert.equal(
          await page.evaluate(() => window.__sailingFixture.apiCalls),
          1
        );
      }
    );
  }

  // whole blocks select one always-visible chart without requests or chance carets
  for (const width of [1280, 375, 320]) {
    await runScenario(
      browser,
      {
        name: `whole-block-selection-${width}`,
        scenario: "success",
        viewport: { width, height: 900 },
      },
      async (page) => {
        await requestEstimate(page);
        const grid = page.getByLabel("Sailing estimates");
        const blocks = grid.locator(":scope > button");
        assert.equal(await blocks.count(), 3);
        assert.equal(await blocks.nth(1).getAttribute("aria-expanded"), "true");
        assert.equal(
          await page.locator("#sailing-chance-details figure").count(),
          1
        );
        assert.equal(await grid.locator("svg").count(), 0);
        // read the settled shared frame without the one timeline allowed to change
        const snapshot = async () => {
          await page.evaluate(async () => {
            await document.fonts.ready;
            await new Promise((resolve) =>
              window.requestAnimationFrame(() =>
                window.requestAnimationFrame(resolve)
              )
            );
          });
          return page
            .locator('#sailing-chance-details svg[role="img"]')
            .evaluate((svg) => ({
              start: svg.getAttribute("data-domain-start"),
              end: svg.getAttribute("data-domain-end"),
              width: svg.getAttribute("width"),
              height: svg.getAttribute("height"),
              arrival: svg.querySelector('[data-timeline-lane="arrival"]')
                .innerHTML,
              background: svg.querySelector("[data-capacity-background]")
                .innerHTML,
              capacity: svg.querySelector('[data-timeline-lane="capacity"]')
                .innerHTML,
            }));
        };
        const original = await snapshot();
        assert.equal(await page.locator("[data-capacity-area]").count(), 3);
        // labels, times and vessels all activate their enclosing block
        for (const [index, target] of [
          [0, "[data-sailing-label]"],
          [2, "[data-sailing-vessel]"],
          [1, "[data-sailing-time]"],
        ]) {
          await blocks.nth(index).locator(target).click();
          assert.equal(
            await blocks.nth(index).getAttribute("aria-expanded"),
            "true"
          );
          assert.equal(await grid.locator('[aria-expanded="true"]').count(), 1);
          assert.deepEqual(await snapshot(), original);
          assert.equal(
            Number(
              await page
                .locator("[data-cutoff-marker]")
                .getAttribute("data-time")
            ),
            Number(await blocks.nth(index).getAttribute("data-departure-at")) -
              180
          );
          await blocks.nth(index).locator("[data-sailing-chance]").click();
          assert.equal(
            await blocks.nth(index).getAttribute("aria-expanded"),
            "true"
          );
        }
        // native button activation also preserves one selected chart
        await blocks.nth(0).focus();
        await page.keyboard.press("Space");
        assert.equal(await blocks.nth(0).getAttribute("aria-expanded"), "true");
        await page.keyboard.press("Enter");
        assert.equal(await blocks.nth(0).getAttribute("aria-expanded"), "true");
        assert.deepEqual(await snapshot(), original);
        await assertSharePlacement(page);
        await assertTimeline(page, {
          capacity: true,
          internalScroll: width < 400,
          points: baseTimelinePoints,
          screenshotName: `timeline-whole-block-${width}`,
        });
        const next = await page
          .locator('[data-capacity-index="1"] [data-capacity-curve]')
          .getAttribute("data-samples");
        // the earlier fixture leaves room, so its successor must begin empty
        assert.equal(JSON.parse(next)[0].percent, 0);
        assert.equal(
          (await page.evaluate(() => window.__sailingFixture)).apiCalls,
          1
        );
      }
    );
  }

  // dense exhaustion captions retain independent inventories and a stable selection frame
  for (const width of [375, 320]) {
    await runScenario(
      browser,
      {
        name: `multi-full-${width}`,
        scenario: "multi-full",
        viewport: { width, height: 900 },
      },
      async (page) => {
        await requestEstimate(page);
        await assertTimeline(page, {
          capacity: true,
          internalScroll: true,
          screenshotName: `timeline-multi-full-${width}`,
        });
        const series = page.locator("[data-capacity-sailing]");
        assert.equal(await series.count(), 3);
        assert.equal(
          await page.locator("[data-full-capacity-region]").count(),
          3
        );
        assert.equal(await page.locator("[data-conservative-fill]").count(), 3);
        // full backlog carries into each later sailing without collapsing any capacity set
        for (const index of [1, 2]) {
          const samples = JSON.parse(
            await series
              .nth(index)
              .locator("[data-capacity-curve]")
              .getAttribute("data-samples")
          );
          assert.ok(samples[0].percent > 0);
        }
        assert.equal(
          (await page.evaluate(() => window.__sailingFixture)).apiCalls,
          1
        );
      }
    );
  }

  // missing predecessors and tied repair rows cannot suppress valid independent areas
  for (const [scenario, count] of [
    ["capacity-recovery", 2],
    ["tied-repair", 3],
  ]) {
    await runScenario(
      browser,
      {
        name: `${scenario}-mobile`,
        scenario,
        viewport: { width: 375, height: 900 },
      },
      async (page) => {
        await requestEstimate(page);
        await assertTimeline(page, {
          capacity: true,
          internalScroll: true,
          screenshotName: `timeline-${scenario}`,
        });
        assert.equal(await page.locator("[data-capacity-area]").count(), count);
        // recovered Later retains direct occupancy rather than assuming an empty terminal
        if (scenario === "capacity-recovery") {
          const series = page.locator("[data-capacity-sailing]").first();
          assert.equal(await series.getAttribute("data-model-basis"), "live");
          const samples = JSON.parse(
            await series
              .locator("[data-capacity-curve]")
              .getAttribute("data-samples")
          );
          assert.ok(samples[0].percent > 0);
        }
        assert.equal(
          (await page.evaluate(() => window.__sailingFixture)).apiCalls,
          1
        );
      }
    );
  }

  // prove the complete drive result, details, attribution and buffer reselection
  await runScenario(
    browser,
    {
      name: "success-desktop-light",
      scenario: "success",
      viewport: { height: 900, width: 1280 },
    },
    async (page) => {
      await requestEstimate(page);
      assert.match(
        await arrivalTime(page).getAttribute("class"),
        /text-green-dark/
      );
      await page.getByText("Light traffic", { exact: true }).waitFor();
      await assertSailingTrio(page, [
        "MV Earlier Fixture",
        "MV Estimated Fixture",
        "MV Later Fixture",
      ]);
      await assertSharePlacement(page);
      assert.equal(await page.getByText(/Tight timing:/).count(), 0);
      await page.getByLabel("Safety buffer (minutes)").fill("17");
      const chance = page.getByRole("button", {
        name: /^Estimated:/,
      });
      await chance.click();
      assert.equal(await chance.getAttribute("aria-expanded"), "true");
      await assertTimeline(page, {
        capacity: true,
        points: [...baseTimelinePoints, ...liveCapacityTimelinePoints],
        screenshotName: "timeline-success-desktop",
        unknownFill: true,
      });
      assert.equal(
        await page
          .getByText(/Planning ranges use assumed triangular distributions/)
          .count(),
        0
      );
      assert.equal(await chance.locator("svg").count(), 0);
      assert.equal(
        await page.getByText("Estimated chance", { exact: true }).count(),
        0
      );
      assert.equal(
        (await page.evaluate(() => window.__sailingFixture)).apiCalls,
        1
      );
      await page.getByLabel("Safety buffer (minutes)").fill("21");
      await page
        .getByLabel("Sailing estimates")
        .getByText("MV Later Fixture", { exact: true })
        .waitFor();
      assert.equal(
        (await page.evaluate(() => window.__sailingFixture)).apiCalls,
        1
      );
      const resultCard = page.locator(
        "section[aria-labelledby='sailing-recommendation-title']"
      );
      assert.equal(await resultCard.getByText(/Google Maps/).count(), 0);
      const attribution = resultCard.locator("+ p[translate='no']");
      assert.match(
        await attribution.innerText(),
        /^Google Maps · ©\d{4} Google$/
      );
      assert.match(await attribution.getAttribute("class"), /text-xs/);
      assert.doesNotMatch(
        await attribution.locator("..").getAttribute("class"),
        /bg-white|rounded-2xl/
      );
    }
  );

  // prove the compact three-column result is bounded on a mobile viewport
  await runScenario(
    browser,
    {
      name: "success-mobile-light",
      scenario: "success",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await requestEstimate(page);
      await assertSailingTrio(page, [
        "MV Earlier Fixture",
        "MV Estimated Fixture",
        "MV Later Fixture",
      ]);
      await assertSharePlacement(page);
      assert.equal(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth
        ),
        true
      );
      const buttons = page
        .getByLabel("Sailing estimates")
        .getByRole("button", { name: /^(Earlier|Estimated|Later):/ });
      assert.equal(await buttons.count(), 3);
      await buttons.nth(1).click();
      await assertTimeline(page, {
        capacity: true,
        internalScroll: true,
        points: [...baseTimelinePoints, ...liveCapacityTimelinePoints],
        screenshotName: "timeline-success-mobile",
        unknownFill: true,
      });
    }
  );

  // prove the aligned arrival header does not collide at a narrow phone width
  await runScenario(
    browser,
    {
      name: "success-narrow-light",
      scenario: "success",
      viewport: { height: 812, width: 320 },
    },
    async (page) => {
      await requestEstimate(page);
      await assertSailingTrio(page, [
        "MV Earlier Fixture",
        "MV Estimated Fixture",
        "MV Later Fixture",
      ]);
      await assertSharePlacement(page);
      await page.getByRole("button", { name: /^Estimated:/ }).click();
      await assertTimeline(page, {
        capacity: true,
        internalScroll: true,
        points: [...baseTimelinePoints, ...liveCapacityTimelinePoints],
        screenshotName: "timeline-success-narrow",
        unknownFill: true,
      });
    }
  );

  // keep the actual-area caption clear of right-edge arrival labels on phones
  for (const width of [375, 320]) {
    await runScenario(
      browser,
      {
        name: `success-earlier-${width}-light`,
        scenario: "success",
        viewport: { height: 812, width },
      },
      async (page) => {
        await requestEstimate(page);
        await page.getByRole("button", { name: /^Earlier:/ }).click();
        await assertTimeline(page, {
          capacity: true,
          internalScroll: true,
          points: baseTimelinePoints,
          screenshotName: `timeline-success-earlier-${width}`,
        });
      }
    );
  }

  // prove shared controls restore, persist and navigate without automatic estimates
  await runScenario(
    browser,
    {
      hash: "anchor&tripAddress=Shared+Fixture+Origin",
      initialStorage: { "ferry-fyi-sailing-buffer-minutes": "18" },
      name: "url-share-history-mobile",
      scenario: "success",
      searchParams: {
        keep: "yes",
        tripBuffer: "7",
        tripMode: "transit",
      },
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      const addressInput = page.getByLabel("Starting address");
      const bufferInput = page.getByLabel("Safety buffer (minutes)");
      assert.equal(
        await page.locator('button[aria-pressed="true"]').innerText(),
        "Transit"
      );
      assert.equal(await bufferInput.inputValue(), "7");
      assert.equal(await addressInput.inputValue(), "Shared Fixture Origin");
      let audit = await page.evaluate(() => window.__sailingFixture);
      assert.equal(audit.apiCalls, 0);
      assert.equal(audit.locationRequests, 0);
      assert.equal(audit.shareCalls, 0);
      assert.equal(
        await page.evaluate(() =>
          window.localStorage.getItem("ferry-fyi-sailing-buffer-minutes")
        ),
        "18"
      );

      const editedAddress = "123 Fixture Share Lane #4";
      await addressInput.fill(editedAddress);
      await page.getByRole("button", { name: "Walk" }).click();
      await bufferInput.fill("0");
      await page.waitForFunction(
        ({ address }) => {
          const url = new URL(window.location.href);
          return (
            url.searchParams.get("tripMode") === "walk" &&
            url.searchParams.get("tripBuffer") === "0" &&
            url.searchParams.get("keep") === "yes" &&
            new URLSearchParams(url.hash.slice(1)).get("tripAddress") ===
              address
          );
        },
        { address: editedAddress }
      );
      assert.equal(await addressInput.inputValue(), editedAddress);
      let url = new URL(page.url());
      assert.doesNotMatch(url.search, /Fixture|Share|Lane/u);
      assert.match(url.hash, /^#anchor&/u);
      assert.equal(
        await page.evaluate(() =>
          window.localStorage.getItem("ferry-fyi-sailing-buffer-minutes")
        ),
        "0"
      );
      await page.getByRole("button", { name: "Estimate trip" }).click();
      await page
        .getByText("Estimated terminal arrival", { exact: true })
        .waitFor();
      assert.equal(await addressInput.inputValue(), editedAddress);
      audit = await page.evaluate(() => window.__sailingFixture);
      assert.equal(audit.apiCalls, 1);
      assert.equal(audit.lastMode, "walk");
      assert.equal(audit.lastOriginKind, "address");
      await assertSharePlacement(page);
      await page.screenshot({
        fullPage: true,
        path: path.join(evidenceDirectory, "url-share-result-mobile.png"),
      });
      await page.getByRole("button", { name: "Share trip" }).click();
      await page.waitForFunction(
        () => window.__sailingFixture.shareCalls === 1
      );
      audit = await page.evaluate(() => window.__sailingFixture);
      assert.equal(audit.lastSharedUrl, page.url());
      assert.doesNotMatch(
        audit.lastSharedUrl ?? "",
        /latitude|longitude|47\.9|122\.3/u
      );

      // mode changes invalidate results while retaining the intentional address
      await page.getByRole("button", { name: "Transit" }).click();
      assert.equal(await addressInput.inputValue(), editedAddress);
      await page.getByLabel("Sailing estimates").waitFor({ state: "detached" });
      assert.equal(
        (await page.evaluate(() => window.__sailingFixture)).apiCalls,
        1
      );
      await page.getByRole("button", { name: "Walk" }).click();
      await page.getByRole("button", { name: "Estimate trip" }).click();
      await page.getByLabel("Sailing estimates").waitFor();
      const sharedUrl = page.url();
      assert.equal(
        (await page.evaluate(() => window.__sailingFixture)).apiCalls,
        2
      );

      const historyAddress = "History Fixture Origin";
      const historyUrl = new URL(sharedUrl);
      historyUrl.searchParams.set("tripMode", "bicycle");
      historyUrl.searchParams.set("tripBuffer", "11");
      historyUrl.hash = new URLSearchParams({
        tripAddress: historyAddress,
      }).toString();
      await page.evaluate((nextUrl) => {
        window.history.pushState({ fixture: "history" }, "", nextUrl);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, historyUrl.href);
      await page.waitForFunction(
        ({ address }) =>
          document.querySelector('[aria-label="Starting address"]')?.value ===
          address,
        { address: historyAddress }
      );
      assert.equal(
        await page.locator('button[aria-pressed="true"]').innerText(),
        "Cycle"
      );
      assert.equal(await bufferInput.inputValue(), "11");
      assert.equal(await page.getByLabel("Sailing estimates").count(), 0);
      assert.equal(
        (await page.evaluate(() => window.__sailingFixture)).apiCalls,
        2
      );
      await page.getByRole("button", { name: "Estimate trip" }).click();
      await page.getByLabel("Sailing estimates").waitFor();
      assert.equal(
        (await page.evaluate(() => window.__sailingFixture)).apiCalls,
        3
      );

      await page.evaluate(() => window.history.back());
      await page.waitForFunction(
        ({ address, expectedUrl }) =>
          window.location.href === expectedUrl &&
          document.querySelector('[aria-label="Starting address"]')?.value ===
            address,
        { address: editedAddress, expectedUrl: sharedUrl }
      );
      assert.equal(await page.getByLabel("Sailing estimates").count(), 0);
      assert.equal(
        (await page.evaluate(() => window.__sailingFixture)).apiCalls,
        3
      );

      const hashAddress = "Hash Fixture Origin";
      await page.evaluate((address) => {
        window.location.hash = `bare-anchor&${new URLSearchParams({
          tripAddress: address,
        })}`;
      }, hashAddress);
      await page.waitForFunction(
        ({ address }) =>
          document.querySelector('[aria-label="Starting address"]')?.value ===
          address,
        { address: hashAddress }
      );
      url = new URL(page.url());
      assert.match(url.hash, /^#bare-anchor&/u);
      assert.equal(await page.getByLabel("Sailing estimates").count(), 0);
      audit = await page.evaluate(() => window.__sailingFixture);
      assert.equal(audit.apiCalls, 3);
      assert.equal(audit.locationRequests, 0);
      const storage = await page.evaluate(() => ({ ...window.localStorage }));
      assert.doesNotMatch(
        JSON.stringify(storage),
        /tripAddress|Fixture Origin|Fixture Share|#/u
      );
    }
  );

  // prove the result-shaped skeleton remains throughout a pending success
  await runScenario(
    browser,
    {
      name: "pending-success-mobile",
      scenario: "pending-success",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await page.getByRole("button", { name: "Use my location" }).click();
      await assertLoadingSkeleton(page);
      await page.screenshot({
        fullPage: true,
        path: path.join(
          evidenceDirectory,
          "pending-success-mobile-loading.png"
        ),
      });
      await page
        .getByText("Estimated terminal arrival", { exact: true })
        .waitFor();
      assert.equal(
        await page.getByLabel("Estimating your trip", { exact: true }).count(),
        0
      );
    }
  );

  // prove the narrow loading header keeps its arrival and share shapes separate
  await runScenario(
    browser,
    {
      name: "pending-success-narrow",
      scenario: "pending-success",
      viewport: { height: 812, width: 320 },
    },
    async (page) => {
      await page.getByRole("button", { name: "Use my location" }).click();
      await assertLoadingSkeleton(page);
      await page.screenshot({
        fullPage: true,
        path: path.join(
          evidenceDirectory,
          "pending-success-narrow-loading.png"
        ),
      });
      await page
        .getByText("Estimated terminal arrival", { exact: true })
        .waitFor();
      assert.equal(
        await page.getByLabel("Estimating your trip", { exact: true }).count(),
        0
      );
    }
  );

  // prove provider failure also removes the pending result skeleton
  await runScenario(
    browser,
    {
      name: "pending-error-desktop",
      scenario: "pending-error",
      viewport: { height: 900, width: 1280 },
    },
    async (page) => {
      await page.getByRole("button", { name: "Use my location" }).click();
      await assertLoadingSkeleton(page);
      await page.screenshot({
        fullPage: true,
        path: path.join(evidenceDirectory, "pending-error-desktop-loading.png"),
      });
      await page
        .getByText("Travel estimates are busy. Try again shortly.")
        .waitFor();
      assert.equal(
        await page.getByLabel("Estimating your trip", { exact: true }).count(),
        0
      );
      assert.equal(await page.getByLabel("Sailing estimates").count(), 0);
    }
  );

  // prove the app-defined moderate arrival color and label
  await runScenario(
    browser,
    {
      name: "moderate-mobile-light",
      scenario: "moderate",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await requestEstimate(page);
      assert.match(
        await arrivalTime(page).getAttribute("class"),
        /text-amber-700/
      );
      await page.getByText("Moderate traffic", { exact: true }).waitFor();
      await assertTimeline(page, {
        capacity: true,
        internalScroll: true,
        screenshotName: "timeline-moderate-traffic",
      });
    }
  );

  // prove the heavy arrival color and dark palette together
  await runScenario(
    browser,
    {
      colorScheme: "dark",
      name: "heavy-mobile-dark",
      scenario: "heavy",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await requestEstimate(page);
      assert.equal(await page.locator("html.dark").count(), 1);
      assert.match(
        await arrivalTime(page).getAttribute("class"),
        /text-red-700/
      );
      await page.getByText("Heavy traffic", { exact: true }).waitFor();
      await page
        .getByRole("button", {
          name: /^Estimated:/,
        })
        .click();
      assert.equal(
        await page
          .getByText("Estimated traffic delay", { exact: true })
          .count(),
        0
      );
      await assertTimeline(page, {
        capacity: true,
        internalScroll: true,
        screenshotName: "timeline-heavy-dark",
      });
      // keep uncolored svg labels readable in dark mode
      const darkTimelineColors = await page
        .locator('figure[aria-label="Trip timing timeline"] svg')
        .evaluate((element) => ({
          color: window.getComputedStyle(element).color,
          fills: Array.from(
            element.querySelectorAll(
              "text:not([data-timeline-label]):not([data-lane-caption]):not([data-capacity-caption]):not([data-arrival-caption]):not([data-label-measurement])"
            )
          ).map((label) => window.getComputedStyle(label).fill),
        }));
      assert.ok(darkTimelineColors.fills.length > 0);
      assert.deepEqual(
        new Set(darkTimelineColors.fills),
        new Set([darkTimelineColors.color])
      );
    }
  );

  // prove missing traffic data stays neutral rather than implying light traffic
  await runScenario(
    browser,
    {
      name: "traffic-unavailable-desktop",
      scenario: "traffic-unavailable",
      viewport: { height: 900, width: 1280 },
    },
    async (page) => {
      await requestEstimate(page);
      await page.getByText("Traffic unavailable", { exact: true }).waitFor();
      const classes = await arrivalTime(page).getAttribute("class");
      assert.doesNotMatch(classes, /text-(green|amber|red)/);
      await assertTimeline(page, {
        capacity: true,
        screenshotName: "timeline-traffic-unavailable",
      });
    }
  );

  // prove unknown vehicle inventory is not presented as a zero chance
  await runScenario(
    browser,
    {
      name: "capacity-unavailable-mobile",
      scenario: "capacity-unavailable",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await requestEstimate(page);
      const center = page
        .getByLabel("Sailing estimates")
        .locator(":scope > button")
        .nth(1);
      await center.getByText("Unknown", { exact: true }).waitFor();
      assert.match(
        await center.locator("[data-sailing-chance]").getAttribute("class"),
        /text-gray-dark/
      );
      await center.click();
      assert.equal(await center.getAttribute("aria-expanded"), "true");
      assert.equal(
        await page
          .locator("#sailing-chance-details [data-capacity-area]")
          .count(),
        0
      );
    }
  );

  // prove forecast fullness supplies numeric capacity chances without live anchors
  await runScenario(
    browser,
    {
      name: "forecast-capacity-drive-mobile",
      scenario: "forecast-capacity",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await requestEstimate(page);
      const buttons = page
        .getByLabel("Sailing estimates")
        .getByRole("button", { name: /^(Earlier|Estimated|Later):/ });
      assert.equal(await buttons.count(), 3);
      // retain numeric joint chances for every displayed driver neighbor
      for (const button of await buttons.all()) {
        assert.match(
          await button.locator("[data-sailing-chance]").innerText(),
          /^(?:[<>])?\d+%$/
        );
      }
      assert.equal(
        await page
          .getByLabel("Sailing estimates")
          .getByText("Unknown", { exact: true })
          .count(),
        0
      );
      await buttons.nth(1).click();
      await assertTimeline(page, {
        internalScroll: true,
        screenshotName: "timeline-forecast-capacity",
      });
      assert.equal(
        await page.getByText("Forecasted full chance", { exact: true }).count(),
        0
      );
      const details = page.locator("#sailing-chance-details");
      assert.equal(
        await details
          .getByText("Estimated drive-up spaces at arrival", { exact: true })
          .count(),
        0
      );
      assert.equal(
        await details
          .getByText("WSF capacity observed", { exact: true })
          .count(),
        0
      );
      assert.equal(await details.locator("dl").count(), 0);
    }
  );

  // prove chronological marker spacing remains correct across pacific midnight
  await runScenario(
    browser,
    {
      name: "midnight-timeline-mobile",
      scenario: "midnight",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await requestEstimate(page);
      await page.getByRole("button", { name: /^Estimated:/ }).click();
      await assertTimeline(page, {
        crossDay: true,
        internalScroll: true,
        screenshotName: "timeline-midnight-mobile",
      });
    }
  );

  // prove non-drivers keep timing-only chances despite fixture forecasts
  await runScenario(
    browser,
    {
      name: "forecast-capacity-walk-mobile",
      scenario: "forecast-capacity",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await page.getByRole("button", { name: "Walk" }).click();
      await requestEstimate(page);
      const center = page
        .getByLabel("Sailing estimates")
        .locator(":scope > button")
        .nth(1);
      await center.click();
      assert.equal(
        await page.getByText("Forecasted full chance", { exact: true }).count(),
        0
      );
      assert.equal(
        await page
          .getByText("Capacity estimate uses forecasted fullness.", {
            exact: true,
          })
          .count(),
        0
      );
      assert.equal(
        await page.getByText("Space remaining chance", { exact: true }).count(),
        0
      );
    }
  );

  // prove a displayed sailing becomes an exact hard zero when its clock elapses
  await runScenario(
    browser,
    {
      name: "departed-clock-mobile",
      scenario: "departed-clock",
      fixedTime: "2026-10-05T19:00:00Z",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await page.getByLabel("Safety buffer (minutes)").fill("0");
      // bypass animation-frame stability while the scenario clock is paused
      await page.getByRole("button", { name: "Use my location" }).click({
        force: true,
      });
      await page
        .getByText("Estimated terminal arrival", { exact: true })
        .waitFor();
      const center = page
        .getByLabel("Sailing estimates")
        .locator(":scope > button")
        .nth(0);
      const chance = center;
      assert.notEqual(
        await chance.locator("[data-sailing-chance]").innerText(),
        "0%"
      );
      // cross the fixture departure explicitly instead of racing wall time
      await page.clock.runFor(8_000);
      await chance
        .locator("[data-sailing-chance]")
        .getByText("0%", { exact: true })
        .waitFor();
      // restore natural animation frames after verifying the deterministic boundary
      await page.clock.resume();
      assert.match(
        await chance.locator("[data-sailing-chance]").getAttribute("class"),
        /text-red-700/
      );
      assert.match(
        await center.locator("[data-sailing-time]").getAttribute("class"),
        /text-red-700/
      );
      await chance.click();
      await assertTimeline(page, {
        capacity: true,
        internalScroll: true,
        screenshotName: "timeline-departed-mobile",
      });
    }
  );

  // prove a direct observed zero is presented as a hard zero
  await runScenario(
    browser,
    {
      name: "vehicle-full-mobile",
      scenario: "vehicle-full",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await requestEstimate(page);
      const center = page
        .getByLabel("Sailing estimates")
        .locator(":scope > button")
        .nth(1);
      await center.getByText("0%", { exact: true }).waitFor();
      await center.click();
      assert.equal(await center.getAttribute("aria-expanded"), "true");
      assert.equal(await page.locator('[data-capacity-index="1"]').count(), 1);
      const samples = JSON.parse(
        await page
          .locator('[data-capacity-index="1"] [data-capacity-curve]')
          .getAttribute("data-samples")
      );
      assert.ok(samples.every((sample) => sample.percent === 100));
    }
  );

  // prove the retired tight-timing warning remains absent for a tight outcome
  await runScenario(
    browser,
    {
      name: "tight-timing-mobile",
      scenario: "tight-timing",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await requestEstimate(page);
      await page.getByText("Estimated", { exact: true }).waitFor();
      assert.equal(await page.getByText(/Tight timing:/).count(), 0);
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /WSF advises arriving/i
      );
    }
  );

  // prove a denied foreground request retains an intentional shared manual origin
  await runScenario(
    browser,
    {
      name: "denied-manual-mobile",
      scenario: "denied",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await page.getByRole("button", { name: "Use my location" }).click();
      await page
        .getByText("Location is unavailable. Enter an address instead.")
        .waitFor();
      const address = "123 Browser Privacy Lane, Edmonds, WA";
      await page.getByLabel("Starting address").fill(address);
      await page.getByRole("button", { name: "Estimate trip" }).click();
      await page
        .getByText("Estimated terminal arrival", { exact: true })
        .waitFor();
      assert.equal(
        await page.getByLabel("Starting address").inputValue(),
        address
      );
      const url = new URL(page.url());
      assert.doesNotMatch(url.search, /Browser|Privacy|Edmonds/i);
      assert.equal(
        new URLSearchParams(url.hash.slice(1)).get("tripAddress"),
        address
      );
      await page.getByRole("button", { name: "Walk" }).click();
      assert.equal(
        await page.getByLabel("Starting address").inputValue(),
        address
      );
      await page.getByLabel("Sailing estimates").waitFor({ state: "detached" });
      assert.equal(
        (await page.evaluate(() => window.__sailingFixture)).apiCalls,
        1
      );
    }
  );

  // prove a schedule revision race suppresses the returned estimate
  await runScenario(
    browser,
    {
      name: "stale-desktop",
      scenario: "stale",
      viewport: { height: 900, width: 1280 },
    },
    async (page) => {
      await page.getByRole("button", { name: "Use my location" }).click();
      await page
        .getByText(/estimate expired or the schedule changed/i)
        .waitFor();
      assert.equal(
        await page
          .getByText("Estimated terminal arrival", { exact: true })
          .count(),
        0
      );
    }
  );

  // prove quota failure stays contained within the card
  await runScenario(
    browser,
    {
      name: "provider-error-desktop",
      scenario: "provider-error",
      viewport: { height: 900, width: 1280 },
    },
    async (page) => {
      await page.getByRole("button", { name: "Use my location" }).click();
      await page
        .getByText("Travel estimates are busy. Try again shortly.")
        .waitFor();
      await page.getByText("Today's sailings").waitFor();
    }
  );

  // prove ferry recursion produces its distinct copy and warning
  await runScenario(
    browser,
    {
      colorScheme: "dark",
      name: "recursion-dark-mobile",
      scenario: "recursion",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await page.getByRole("button", { name: "Use my location" }).click();
      await page.getByText(/available route includes ferry travel/i).waitFor();
      await page
        .getByText("Ferry travel is excluded from the route to the terminal.")
        .waitFor();
      await page.keyboard.press("Tab");
      assert.notEqual(
        await page.evaluate(() => document.activeElement?.tagName ?? ""),
        "BODY"
      );
    }
  );
} finally {
  await browser.close();
}

await fs.writeFile(
  path.join(evidenceDirectory, "report.json"),
  `${JSON.stringify(
    {
      baseUrl,
      layoutEvidence,
      results,
      skeletonLayoutEvidence,
      timelineEvidence,
    },
    null,
    2
  )}\n`
);
console.log(
  JSON.stringify(
    {
      evidenceDirectory,
      passed: results.map((result) => result.name),
      scenarioCount: results.length,
    },
    null,
    2
  )
);
