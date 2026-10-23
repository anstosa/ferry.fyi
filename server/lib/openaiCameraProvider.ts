import { OPENAI_CAMERA_PROMPT } from "./openaiCameraPrompt";
import type {
  OpenaiCameraImageResult,
  OpenaiCameraPromptImage,
  OpenaiCameraSectionResult,
} from "./openaiCameraTypes";

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4_000;
const MAX_IMAGES = 32;
const MAX_LANES_PER_IMAGE = 64;
const MAX_BASE64_CHARACTERS = 40_000_000;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OCCUPANCY_STATES = ["empty", "low", "high", "full"] as const;
const IMAGE_DETAILS = ["auto", "low", "high", "original"] as const;

type ImageDetail = "auto" | "low" | "high" | "original";

export interface OpenaiCameraProviderOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  detail?: ImageDetail;
  maxOutputTokens?: number;
}

interface OpenaiResponseEnvelope {
  error?: unknown;
  output?: unknown;
  status?: unknown;
}

// narrow unknown json values to ordinary records
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// require exactly the documented semantic properties
function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    // compare each property name in canonical order
    actual.every((key, index) => key === expected[index])
  );
}

// validate identifiers before placing them in prompts or schemas
function isValidIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

// accept only canonical non-empty base64 without whitespace
function isValidBase64(value: unknown): value is string {
  // reject malformed shape before decoding
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    return false;
  }
  // reject non-canonical encodings
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length > 0 && decoded.toString("base64") === value;
  } catch {
    return false;
  }
}

// fail closed on unsafe provider configuration
function validateOptions(options: OpenaiCameraProviderOptions): void {
  // require a dedicated non-empty credential and explicit model
  if (
    typeof options.apiKey !== "string" ||
    options.apiKey.length > 512 ||
    options.apiKey.trim().length === 0 ||
    /[\r\n]/.test(options.apiKey) ||
    !isValidIdentifier(options.model)
  ) {
    throw new Error("OpenAI camera provider configuration is unavailable");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  // keep local resource settings finite and positive
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 120_000 ||
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens <= 0 ||
    maxOutputTokens > 100_000 ||
    !IMAGE_DETAILS.includes(options.detail ?? "auto")
  ) {
    throw new Error("OpenAI camera provider configuration is unavailable");
  }
}

// validate prompt cardinality before any paid request
function validateImages(images: OpenaiCameraPromptImage[]): void {
  // require a bounded non-empty request
  if (
    !Array.isArray(images) ||
    images.length === 0 ||
    images.length > MAX_IMAGES
  ) {
    throw new Error("OpenAI camera request is invalid");
  }
  const cameraIds = new Set<string>();
  let base64Characters = 0;
  // validate every image and its section identifiers
  for (const image of images) {
    // reject malformed or repeated cameras
    if (
      !isRecord(image) ||
      !isValidIdentifier(image.cameraId) ||
      cameraIds.has(image.cameraId) ||
      !Array.isArray(image.laneIds) ||
      image.laneIds.length === 0 ||
      image.laneIds.length > MAX_LANES_PER_IMAGE ||
      !isValidBase64(image.imageBase64)
    ) {
      throw new Error("OpenAI camera request is invalid");
    }
    cameraIds.add(image.cameraId);
    base64Characters += image.imageBase64.length;
    const laneIds = new Set<string>();
    // require every section exactly once within its image
    for (const laneId of image.laneIds) {
      // reject unknown identifier shapes and duplicates
      if (!isValidIdentifier(laneId) || laneIds.has(laneId)) {
        throw new Error("OpenAI camera request is invalid");
      }
      laneIds.add(laneId);
    }
  }
  // prevent oversized in-memory and provider payloads
  if (base64Characters > MAX_BASE64_CHARACTERS) {
    throw new Error("OpenAI camera request is invalid");
  }
}

// build one strict schema while preserving array response containers
function buildResponseSchema(images: OpenaiCameraPromptImage[]) {
  const cameraIds = images.map(
    // retain only supplied camera identifiers
    (image) => image.cameraId
  );
  const laneIds = [
    ...new Set(
      images.flatMap(
        // retain only supplied lane identifiers
        (image) => image.laneIds
      )
    ),
  ];
  return {
    type: "object",
    additionalProperties: false,
    required: ["images"],
    properties: {
      images: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["cameraId", "visibilityProblems", "lanes"],
          properties: {
            cameraId: { type: "string", enum: cameraIds },
            visibilityProblems: { type: "boolean" },
            lanes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "cameraId",
                  "laneId",
                  "skippedDueToVisibility",
                  "occupancyState",
                  "passing",
                ],
                properties: {
                  cameraId: { type: "string", enum: cameraIds },
                  laneId: { type: "string", enum: laneIds },
                  skippedDueToVisibility: { type: "boolean" },
                  occupancyState: {
                    type: ["string", "null"],
                    enum: [...OCCUPANCY_STATES, null],
                  },
                  passing: { type: ["boolean", "null"] },
                },
              },
            },
          },
        },
      },
    },
  };
}

// build the fixed Responses API request body
function buildRequestBody(
  model: string,
  images: OpenaiCameraPromptImage[],
  detail: ImageDetail,
  maxOutputTokens: number
) {
  const content = images.flatMap(
    // keep each identifier record adjacent to its image
    (image) => [
      {
        type: "input_text",
        text: JSON.stringify({
          cameraId: image.cameraId,
          laneIds: image.laneIds,
          laneMarkers: image.laneIds.map(
            // map one-based image markers to supplied section identifiers
            (laneId, index) => ({ marker: index + 1, laneId })
          ),
        }),
      },
      {
        type: "input_image",
        image_url: `data:image/png;base64,${image.imageBase64}`,
        detail,
      },
    ]
  );
  return {
    model,
    store: false,
    instructions: OPENAI_CAMERA_PROMPT,
    input: [{ role: "user", content }],
    max_output_tokens: maxOutputTokens,
    text: {
      format: {
        type: "json_schema",
        name: "camera_lane_classifications",
        strict: true,
        schema: buildResponseSchema(images),
      },
    },
  };
}

// collect completed output text and reject model refusals
function readOutputText(payload: OpenaiResponseEnvelope): string {
  // require a completed response with an explicit null error
  if (
    payload.status !== "completed" ||
    payload.error !== null ||
    !Array.isArray(payload.output)
  ) {
    throw new Error("OpenAI camera response is invalid");
  }
  const outputText: string[] = [];
  // traverse all response output items
  for (const item of payload.output) {
    // ignore non-message metadata items
    if (!isRecord(item) || item.type !== "message") {
      continue;
    }
    // require message content arrays
    if (!Array.isArray(item.content)) {
      throw new Error("OpenAI camera response is invalid");
    }
    // inspect every message content item
    for (const content of item.content) {
      // reject malformed content records
      if (!isRecord(content)) {
        throw new Error("OpenAI camera response is invalid");
      }
      // reject provider refusals without exposing their text
      if (content.type === "refusal") {
        throw new Error("OpenAI camera response is invalid");
      }
      // retain only typed output text
      if (content.type === "output_text") {
        // reject malformed text fragments
        if (typeof content.text !== "string" || content.text.length === 0) {
          throw new Error("OpenAI camera response is invalid");
        }
        outputText.push(content.text);
      }
    }
  }
  const text = outputText.join("");
  // reject absent output text
  if (text.length === 0) {
    throw new Error("OpenAI camera response is invalid");
  }
  return text;
}

// validate one lane result against the exact submitted identity
function validateLane(
  value: unknown,
  cameraId: string,
  expectedLaneIds: Set<string>,
  seenLaneIds: Set<string>
): OpenaiCameraSectionResult {
  // require the exact semantic lane shape and expected identifiers
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "cameraId",
      "laneId",
      "skippedDueToVisibility",
      "occupancyState",
      "passing",
    ]) ||
    value.cameraId !== cameraId ||
    typeof value.laneId !== "string" ||
    !expectedLaneIds.has(value.laneId) ||
    seenLaneIds.has(value.laneId) ||
    typeof value.skippedDueToVisibility !== "boolean"
  ) {
    throw new Error("OpenAI camera response is invalid");
  }
  const skipped = value.skippedDueToVisibility;
  const occupancy = value.occupancyState;
  const { passing } = value;
  // require null classifications only for skipped sections
  if (skipped) {
    // reject guessed values for obscured sections
    if (occupancy !== null || passing !== null) {
      throw new Error("OpenAI camera response is invalid");
    }
  } else {
    // require complete visible-section classifications
    if (
      typeof occupancy !== "string" ||
      !OCCUPANCY_STATES.includes(
        occupancy as (typeof OCCUPANCY_STATES)[number]
      ) ||
      typeof passing !== "boolean"
    ) {
      throw new Error("OpenAI camera response is invalid");
    }
    // empty sections cannot indicate passing traffic
    if (occupancy === "empty" && passing) {
      throw new Error("OpenAI camera response is invalid");
    }
  }
  seenLaneIds.add(value.laneId);
  return value as unknown as OpenaiCameraSectionResult;
}

// validate exact response cardinality and visibility semantics
function validateResult(
  value: unknown,
  images: OpenaiCameraPromptImage[]
): OpenaiCameraImageResult[] {
  // require the exact root shape
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["images"]) ||
    !Array.isArray(value.images) ||
    value.images.length !== images.length
  ) {
    throw new Error("OpenAI camera response is invalid");
  }
  const expected = new Map(
    images.map(
      // index submitted identities for exact-cardinality checks
      (image) => [image.cameraId, image] as const
    )
  );
  const seenCameraIds = new Set<string>();
  const results: OpenaiCameraImageResult[] = [];
  // validate each returned image exactly once
  for (const valueImage of value.images) {
    // require the exact image shape and known camera
    if (
      !isRecord(valueImage) ||
      !hasExactKeys(valueImage, ["cameraId", "visibilityProblems", "lanes"]) ||
      typeof valueImage.cameraId !== "string" ||
      seenCameraIds.has(valueImage.cameraId) ||
      typeof valueImage.visibilityProblems !== "boolean" ||
      !Array.isArray(valueImage.lanes)
    ) {
      throw new Error("OpenAI camera response is invalid");
    }
    const { cameraId } = valueImage;
    const submitted = expected.get(cameraId);
    // reject unknown cameras and incorrect section cardinality
    if (!submitted || valueImage.lanes.length !== submitted.laneIds.length) {
      throw new Error("OpenAI camera response is invalid");
    }
    const expectedLaneIds = new Set(submitted.laneIds);
    const seenLaneIds = new Set<string>();
    const lanes = valueImage.lanes.map(
      // validate every lane against its parent image
      (lane) => validateLane(lane, cameraId, expectedLaneIds, seenLaneIds)
    );
    // require every submitted lane identifier exactly once
    if (seenLaneIds.size !== expectedLaneIds.size) {
      throw new Error("OpenAI camera response is invalid");
    }
    // require image-wide visibility to stop all classification
    if (
      valueImage.visibilityProblems &&
      lanes.some(
        // detect any lane that ignored the image-wide stop
        (lane) =>
          !lane.skippedDueToVisibility ||
          lane.occupancyState !== null ||
          lane.passing !== null
      )
    ) {
      throw new Error("OpenAI camera response is invalid");
    }
    seenCameraIds.add(cameraId);
    results.push({
      cameraId,
      visibilityProblems: valueImage.visibilityProblems,
      lanes,
    });
  }
  // require every submitted camera identifier exactly once
  if (seenCameraIds.size !== expected.size) {
    throw new Error("OpenAI camera response is invalid");
  }
  return results;
}

// submit validated image batches without sharing credentials or retrying spend
export class OpenaiCameraProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly detail: ImageDetail;
  private readonly maxOutputTokens: number;

  // capture an explicit server-only provider configuration
  constructor(options: OpenaiCameraProviderOptions) {
    validateOptions(options);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.detail = options.detail ?? "auto";
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  }

  // submit one bounded no-retry classification request
  async classify(
    images: OpenaiCameraPromptImage[],
    signal?: AbortSignal
  ): Promise<OpenaiCameraImageResult[]> {
    validateImages(images);
    // reject already-cancelled work before network access
    if (signal?.aborted) {
      throw new Error("OpenAI camera request was cancelled");
    }
    const abortController = new AbortController();
    let timedOut = false;
    // relay caller cancellation to the provider request
    const cancel = () => {
      abortController.abort();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(
      // bound provider latency without retrying
      () => {
        timedOut = true;
        abortController.abort();
      },
      this.timeoutMs
    );
    // release timeout and caller cancellation listeners
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    };
    let response: Response;
    // isolate transport failures from provider details
    try {
      response = await this.fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildRequestBody(
            this.model,
            images,
            this.detail,
            this.maxOutputTokens
          )
        ),
        signal: abortController.signal,
      });
    } catch {
      cleanup();
      // distinguish bounded cancellation states without leaking causes
      if (timedOut) {
        throw new Error("OpenAI camera request timed out");
      }
      // preserve caller cancellation as a bounded result
      if (signal?.aborted) {
        throw new Error("OpenAI camera request was cancelled");
      }
      throw new Error("OpenAI camera request failed");
    }
    // reject abort-ignoring fetch implementations consistently
    if (timedOut) {
      cleanup();
      throw new Error("OpenAI camera request timed out");
    }
    // honor cancellation even when the injected fetch ignores aborts
    if (signal?.aborted) {
      cleanup();
      throw new Error("OpenAI camera request was cancelled");
    }
    // reject non-success status without reading or echoing its body
    if (!response.ok) {
      cleanup();
      throw new Error("OpenAI camera request failed");
    }
    let payload: OpenaiResponseEnvelope;
    // parse response json without retaining parser or body details
    try {
      payload = (await response.json()) as OpenaiResponseEnvelope;
    } catch {
      // distinguish a body-read timeout from malformed json
      if (timedOut) {
        throw new Error("OpenAI camera request timed out");
      }
      // distinguish caller cancellation during body reading
      if (signal?.aborted) {
        throw new Error("OpenAI camera request was cancelled");
      }
      throw new Error("OpenAI camera response is invalid");
    } finally {
      cleanup();
    }
    // reject a body read that completed after its deadline
    if (timedOut) {
      throw new Error("OpenAI camera request timed out");
    }
    // reject body data returned after caller cancellation
    if (signal?.aborted) {
      throw new Error("OpenAI camera request was cancelled");
    }
    let parsed: unknown;
    // parse the strict model output without exposing raw output
    try {
      parsed = JSON.parse(readOutputText(payload));
    } catch (error) {
      // preserve only our bounded validation errors
      if (
        error instanceof Error &&
        error.message === "OpenAI camera response is invalid"
      ) {
        throw error;
      }
      throw new Error("OpenAI camera response is invalid");
    }
    return validateResult(parsed, images);
  }
}
