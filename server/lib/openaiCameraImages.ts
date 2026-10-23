import { createHash } from "node:crypto";

import type {
  OpenaiCameraDefinition,
  PreparedOpenaiCameraImage,
} from "./openaiCameraTypes";

export interface OpenaiCameraPreparedFrame {
  image: PreparedOpenaiCameraImage;
  frameToken: string;
  frameUpdatedAt: number | null;
}

interface ImageClientOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PREPARED_BYTES = 16 * 1024 * 1024;

// bound trusted-origin responses before decoding or retaining image bytes
const readBoundedBody = async (
  response: Response,
  limit: number
): Promise<Buffer> => {
  // reject missing and explicitly oversized bodies
  if (
    !response.body ||
    Number(response.headers.get("content-length")) > limit
  ) {
    await response.body?.cancel();
    throw new Error("Camera image response exceeds the size limit");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  // enforce the bound even when content-length is absent
  while (true) {
    const { done, value } = await reader.read();
    // finish the bounded stream
    if (done) {
      break;
    }
    size += value.length;
    // stop an oversized chunked response
    if (size > limit) {
      await reader.cancel();
      throw new Error("Camera image response exceeds the size limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
};

// keep image preparation independent of both YOLO and model inference
export class OpenaiCameraImageClient {
  private options: ImageClientOptions;

  // retain explicit server-only preprocessor configuration
  constructor(options: ImageClientOptions) {
    const endpoint = new URL(options.endpoint);
    // allow private HTTP services but never non-http transports
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password
    ) {
      throw new Error("Invalid camera preprocessor endpoint");
    }
    this.options = options;
  }

  // fetch and prepare one reviewed image without archiving raw bytes
  async prepare(
    definition: OpenaiCameraDefinition,
    cancellation: AbortSignal
  ): Promise<OpenaiCameraPreparedFrame> {
    const url = new URL(definition.config.imageUrl);
    // keep camera fetches within the canonical upstream origin
    if (
      url.protocol !== "https:" ||
      url.hostname !== "images.wsdot.wa.gov" ||
      url.port ||
      url.username ||
      url.password
    ) {
      throw new Error("Camera image must use the WSDOT image origin");
    }
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const signal = AbortSignal.any([
      cancellation,
      AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
    ]);
    const response = await fetchImpl(url.href, { redirect: "error", signal });
    // never classify a source failure as an empty lane
    if (!response.ok) {
      throw new Error(`Camera image HTTP ${response.status}`);
    }
    const raw = await readBoundedBody(response, MAX_IMAGE_BYTES);
    const modified = Date.parse(response.headers.get("last-modified") ?? "");
    const frameToken = createHash("sha256")
      .update(response.headers.get("etag") ?? "")
      .update(response.headers.get("last-modified") ?? "")
      .update(raw)
      .digest("hex");
    const preparedResponse = await fetchImpl(this.options.endpoint, {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "image/jpeg",
        "X-Camera-Id": definition.cameraId,
        "X-Detection-Areas": JSON.stringify({
          allowedAreas: definition.config.allowedAreas,
          excludedAreas: definition.config.excludedAreas,
          frameSize: definition.config.frameSize,
        }),
      },
      body: new Uint8Array(raw).buffer,
    });
    // reject preprocessing failures before any paid call
    if (!preparedResponse.ok) {
      throw new Error(`Camera preprocessor HTTP ${preparedResponse.status}`);
    }
    const body: unknown = JSON.parse(
      (await readBoundedBody(preparedResponse, MAX_PREPARED_BYTES)).toString(
        "utf8"
      )
    );
    // require the declared processor contract
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Malformed camera preprocessor response");
    }
    const candidate = body as Record<string, unknown>;
    const laneIds = definition.config.allowedAreas.map((area) => area.id);
    // verify geometry, fingerprint, image bytes and section cardinality
    if (
      ![
        candidate.width,
        candidate.height,
        candidate.sourceWidth,
        candidate.sourceHeight,
      ].every(
        (value) =>
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value > 0 &&
          value <= 20_000
      ) ||
      typeof candidate.rotationDegrees !== "number" ||
      !Number.isFinite(candidate.rotationDegrees) ||
      typeof candidate.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(candidate.fingerprint) ||
      typeof candidate.imageBase64 !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(candidate.imageBase64) ||
      candidate.imageBase64.length > MAX_PREPARED_BYTES ||
      !Buffer.from(candidate.imageBase64, "base64")
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      !Array.isArray(candidate.laneIds) ||
      candidate.laneIds.length !== laneIds.length ||
      new Set(candidate.laneIds).size !== laneIds.length ||
      candidate.laneIds.some(
        (id) => typeof id !== "string" || !laneIds.includes(id)
      )
    ) {
      throw new Error("Malformed camera preprocessor response");
    }
    return {
      frameToken,
      frameUpdatedAt: Number.isFinite(modified) ? modified : null,
      image: {
        ...(candidate as unknown as PreparedOpenaiCameraImage),
        cameraId: definition.cameraId,
      },
    };
  }
}
