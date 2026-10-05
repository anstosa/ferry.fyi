import type { TravelMode } from "shared/contracts/sailingRecommendations";

export interface SailingTrip {
  address: string;
  buffer: number;
  mode: TravelMode;
}

// identify only the private address key without rewriting unrelated bare anchors
const isAddressSegment = (segment: string): boolean =>
  new URLSearchParams(segment).has("tripAddress");

// parse bounded controls without accepting an address from an HTTP query
export const parseSailingTrip = (
  search: string,
  hash: string,
  defaultBuffer = 5
): SailingTrip => {
  const query = new URLSearchParams(search);
  const mode = query.get("tripMode");
  const rawBuffer = query.get("tripBuffer");
  const buffer =
    rawBuffer === null || rawBuffer.trim() === "" ? NaN : Number(rawBuffer);
  const address =
    new URLSearchParams(hash.replace(/^#/, "")).get("tripAddress") ?? "";
  // reject control bytes without restricting normal unicode addresses
  const validAddress =
    address.length <= 200 &&
    Array.from(address).every(
      (character) =>
        character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127
    );
  return {
    address: validAddress ? address : "",
    buffer:
      Number.isInteger(buffer) && buffer >= 0 && buffer <= 60
        ? buffer
        : defaultBuffer,
    mode:
      mode === "walk" || mode === "bicycle" || mode === "transit"
        ? mode
        : "drive",
  };
};

// remove the private fragment before diagnostic or authentication retention
export const stripSailingTripAddress = (url: string): string => {
  const boundary = url.indexOf("#");
  // unrelated URLs and text remain untouched
  if (boundary < 0) {
    return url;
  }
  const segments = url
    .slice(boundary + 1)
    .split("&")
    .filter((segment) => !isAddressSegment(segment));
  return `${url.slice(0, boundary)}${segments.length ? `#${segments.join("&")}` : ""}`;
};

// retain route parameters and anchors while keeping the address out of page requests
export const withSailingTrip = (url: string, trip: SailingTrip): string => {
  const parsed = new URL(stripSailingTripAddress(url), "https://ferry.fyi");
  parsed.searchParams.delete("tripAddress");
  parsed.searchParams.set("tripMode", trip.mode);
  parsed.searchParams.set("tripBuffer", String(trip.buffer));
  let { hash } = parsed;
  // encode the address as one fragment field only when entered
  if (trip.address) {
    const address = new URLSearchParams({
      tripAddress: trip.address,
    }).toString();
    hash = `${hash}${hash ? "&" : "#"}${address}`;
  }
  return `${parsed.pathname}${parsed.search}${hash}`;
};

// turn a native webview route into an externally usable trip link
export const getSailingTripShareUrl = (
  url: string,
  native: boolean,
  baseUrl = "https://ferry.fyi"
): string => {
  // preserve the actual browser origin for web and local previews
  if (!native) {
    return url;
  }
  const route = new URL(url);
  return new URL(`${route.pathname}${route.search}${route.hash}`, baseUrl).href;
};

// scrub serialized telemetry URLs without mutating SDK-owned payloads
export const redactSailingTripTelemetry = <Value>(value: Value): Value => {
  const seen = new WeakMap<object, unknown>();
  // visit plain telemetry records and leave native objects intact
  const visit = (item: unknown): unknown => {
    // strip addresses from request URLs, navigation breadcrumbs and span fields
    if (typeof item === "string") {
      return stripSailingTripAddress(item);
    }
    // preserve non-record values and native objects
    if (
      !item ||
      typeof item !== "object" ||
      (!Array.isArray(item) &&
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null)
    ) {
      return item;
    }
    // preserve cycles for the SDK's subsequent normalization
    if (seen.has(item)) {
      return seen.get(item);
    }
    const result: Record<string, unknown> | unknown[] = Array.isArray(item)
      ? []
      : {};
    seen.set(item, result);
    // sanitize every serialized field including SDK-version-specific URL metadata
    for (const [key, entry] of Object.entries(item)) {
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: visit(entry),
        writable: true,
      });
    }
    return result;
  };
  return visit(value) as Value;
};
