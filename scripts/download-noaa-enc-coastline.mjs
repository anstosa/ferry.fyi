#!/usr/bin/env node
/**
 * Pins the NOAA ENC Direct Harbour COALNE layer needed by vessel check-ins.
 * This is intentionally a bounded extract, not a navigation data download.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const service =
  "https://encdirect.noaa.gov/arcgis/rest/services/encdirect";
const bbox = [-123.6, 46.9, -121.8, 48.7];
const layers = [
  { key: "coastlines", path: "enc_harbour/MapServer/84" },
  { key: "coverage", path: "enc_coverage/MapServer/4" },
];
const output = resolve("server/data/noaa-enc-harbour-puget-sound.json");
const metadataOutput = resolve(
  "server/data/noaa-enc-harbour-puget-sound.metadata.json"
);

const query = async (path, parameters) => {
  const url = new URL(`${service}/${path}/query`);
  Object.entries({ f: "json", ...parameters }).forEach(([key, value]) =>
    url.searchParams.set(key, String(value))
  );
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`NOAA request failed: ${response.status} (${url})`);
  const body = await response.json();
  if (body.error) throw new Error(`NOAA query failed: ${body.error.message}`);
  return body;
};

const commonQuery = {
  geometry: bbox.join(","),
  geometryType: "esriGeometryEnvelope",
  inSR: 4326,
  spatialRel: "esriSpatialRelIntersects",
  where: "1=1",
};

const getFeatures = async (path) => {
  const ids = await query(path, { ...commonQuery, returnIdsOnly: true });
  const objectIds = ids.objectIds ?? [];
  const features = [];
  // NOAA's ArcGIS gateway rejects long GET query strings, so keep these small.
  for (let offset = 0; offset < objectIds.length; offset += 50) {
    const page = await query(path, {
      f: "geojson",
      objectIds: objectIds.slice(offset, offset + 50).join(","),
      outSR: 4326,
      outFields: "*",
      returnGeometry: true,
    });
    features.push(...(page.features ?? []));
  }
  return features;
};

const retrievedAt = new Date().toISOString();
const extracted = Object.fromEntries(
  await Promise.all(
    layers.map(async ({ key, path }) => [key, await getFeatures(path)])
  )
);
const snapshot = {
  type: "FeatureCollection",
  features: [
    ...extracted.coastlines.map((feature) => ({
      ...feature,
      properties: { ...feature.properties, snapshotLayer: "coastline" },
    })),
    ...extracted.coverage.map((feature) => ({
      ...feature,
      properties: { ...feature.properties, snapshotLayer: "coverage" },
    })),
  ],
};
const serialized = `${JSON.stringify(snapshot)}\n`;
const sha256 = createHash("sha256").update(serialized).digest("hex");
const metadata = {
  artifact: "noaa-enc-harbour-puget-sound.json",
  bbox: { east: bbox[2], north: bbox[3], south: bbox[1], west: bbox[0] },
  coastlineFeatureCount: extracted.coastlines.length,
  coverageFeatureCount: extracted.coverage.length,
  license: "U.S. Government work; NOAA ENC Direct terms apply. See source URL.",
  process: "Harbour COALNE and Harbour coverage features intersecting bbox, requested as GeoJSON from NOAA ArcGIS REST, then normalized into one FeatureCollection.",
  retrievedAt,
  sha256,
  sourceUrls: layers.map(({ path }) => `${service}/${path}/query`),
  version: "NOAA ENC Direct Harbour snapshot",
  warning: "ENC Direct GIS data are not certified for navigation and are used only for non-navigation leaderboard eligibility.",
};
await mkdir(dirname(output), { recursive: true });
await Promise.all([
  writeFile(output, serialized),
  writeFile(metadataOutput, `${JSON.stringify(metadata, null, 2)}\n`),
]);
console.log(`Wrote ${output} (${sha256})`);
