import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OPENAI_CAMERA_PROMPT,
  OPENAI_CAMERA_PROMPT_VERSION,
} from "../../server/lib/openaiCameraPrompt";
import {
  OpenaiCameraProvider,
  type OpenaiCameraProviderOptions,
} from "../../server/lib/openaiCameraProvider";
import type {
  OpenaiCameraImageResult,
  OpenaiCameraPromptImage,
  OpenaiCameraSectionResult,
} from "../../server/lib/openaiCameraTypes";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const IMAGES: OpenaiCameraPromptImage[] = [
  {
    cameraId: "camera-one",
    imageBase64: PNG_BASE64,
    laneIds: ["lane-one-front", "lane-one-back"],
  },
  {
    cameraId: "camera-two",
    imageBase64: PNG_BASE64,
    laneIds: ["lane-two"],
  },
];

// create one visible lane result
function visibleLane(
  cameraId: string,
  laneId: string,
  occupancyState: OpenaiCameraSectionResult["occupancyState"] = "high",
  passing = false
): OpenaiCameraSectionResult {
  return {
    cameraId,
    laneId,
    skippedDueToVisibility: false,
    occupancyState,
    passing,
  };
}

// create one visibility-skipped lane result
function skippedLane(
  cameraId: string,
  laneId: string
): OpenaiCameraSectionResult {
  return {
    cameraId,
    laneId,
    skippedDueToVisibility: true,
    occupancyState: null,
    passing: null,
  };
}

const VALID_RESULTS: OpenaiCameraImageResult[] = [
  {
    cameraId: "camera-one",
    visibilityProblems: false,
    lanes: [
      visibleLane("camera-one", "lane-one-front", "full"),
      visibleLane("camera-one", "lane-one-back", "low", true),
    ],
  },
  {
    cameraId: "camera-two",
    visibilityProblems: false,
    lanes: [visibleLane("camera-two", "lane-two", "empty")],
  },
];

// build a completed Responses API envelope
function completedPayload(value: unknown) {
  return {
    status: "completed",
    error: null,
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(value),
          },
        ],
      },
    ],
  };
}

// wrap strict json in a completed Responses API response
function completedResponse(value: unknown): Response {
  return new Response(JSON.stringify(completedPayload(value)), { status: 200 });
}

// construct the provider around a fully mocked fetch
function provider(
  fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>,
  overrides: Partial<OpenaiCameraProviderOptions> = {}
): OpenaiCameraProvider {
  return new OpenaiCameraProvider({
    apiKey: "synthetic-dedicated-camera-key",
    model: "synthetic-camera-model",
    fetchImpl,
    ...overrides,
  });
}

// restore timer and mock state between provider cases
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// group prompt contract cases
describe("OpenAI camera prompt", () => {
  // preserve the approved semantic instructions and a cacheable version
  it("exports the approved strict classification prompt", () => {
    expect(OPENAI_CAMERA_PROMPT_VERSION).toBe("2026-10-23.1");
    expect(OPENAI_CAMERA_PROMPT).toContain(
      'Return exactly one JSON object with an "images" array.'
    );
    expect(OPENAI_CAMERA_PROMPT).toContain(
      "Black pixels outside the target regions are intentional masks"
    );
    expect(OPENAI_CAMERA_PROMPT).toContain(
      "Numeric markers 1..N identify the supplied lane-section IDs"
    );
    expect(OPENAI_CAMERA_PROMPT).toContain(
      'occupancyState: "empty", "low", "high", "full", or null only when skipped'
    );
    expect(OPENAI_CAMERA_PROMPT).toContain(
      "Classify front and back lane sections independently."
    );
    expect(OPENAI_CAMERA_PROMPT).toContain(
      "Return no IDs that were not supplied and no additional properties."
    );
  });
});

// group outbound provider request cases
describe("OpenAI camera provider request", () => {
  // send arrays of identified png images through one no-store request
  it("uses the Responses API with strict dynamic schema enums", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(completedResponse({ images: VALID_RESULTS }));

    await expect(provider(fetchImpl).classify(IMAGES)).resolves.toEqual(
      VALID_RESULTS
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(options?.method).toBe("POST");
    expect(options?.headers).toEqual({
      Authorization: "Bearer synthetic-dedicated-camera-key",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({
      model: "synthetic-camera-model",
      store: false,
      instructions: OPENAI_CAMERA_PROMPT,
      max_output_tokens: 4_000,
      text: {
        format: {
          type: "json_schema",
          name: "camera_lane_classifications",
          strict: true,
        },
      },
    });
    expect(body.input).toEqual([
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              cameraId: "camera-one",
              laneIds: ["lane-one-front", "lane-one-back"],
              laneMarkers: [
                { marker: 1, laneId: "lane-one-front" },
                { marker: 2, laneId: "lane-one-back" },
              ],
            }),
          },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${PNG_BASE64}`,
            detail: "auto",
          },
          {
            type: "input_text",
            text: JSON.stringify({
              cameraId: "camera-two",
              laneIds: ["lane-two"],
              laneMarkers: [{ marker: 1, laneId: "lane-two" }],
            }),
          },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${PNG_BASE64}`,
            detail: "auto",
          },
        ],
      },
    ]);
    const { schema } = body.text.format;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.images.items.additionalProperties).toBe(false);
    expect(
      schema.properties.images.items.properties.lanes.items.additionalProperties
    ).toBe(false);
    expect(schema.properties.images.items.properties.cameraId.enum).toEqual([
      "camera-one",
      "camera-two",
    ]);
    expect(
      schema.properties.images.items.properties.lanes.items.properties.laneId
        .enum
    ).toEqual(["lane-one-front", "lane-one-back", "lane-two"]);
    expect(
      schema.properties.images.items.properties.lanes.items.properties
        .occupancyState.enum
    ).toEqual(["empty", "low", "high", "full", null]);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  // retain explicit request tuning without hidden defaults
  it("passes configured detail and output bounds", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(completedResponse({ images: VALID_RESULTS }));
    await provider(fetchImpl, {
      detail: "original",
      maxOutputTokens: 987,
    }).classify(IMAGES);
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.max_output_tokens).toBe(987);
    expect(body.input[0].content[1].detail).toBe("original");
  });

  // reject malformed work before a paid provider call
  it.each([
    [],
    [{ ...IMAGES[0], cameraId: "" }],
    [{ ...IMAGES[0], imageBase64: "not base64" }],
    [{ ...IMAGES[0], laneIds: [] }],
    [{ ...IMAGES[0], laneIds: ["same", "same"] }],
    [IMAGES[0], { ...IMAGES[1], cameraId: IMAGES[0].cameraId }],
  ])("rejects invalid inputs without fetching %#", async (images) => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(provider(fetchImpl).classify(images)).rejects.toThrow(
      "OpenAI camera request is invalid"
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // reject missing dedicated configuration during construction
  it.each([
    { apiKey: "", model: "synthetic-model" },
    { apiKey: "synthetic-key", model: "" },
    { apiKey: "synthetic-key", model: "model\nunsafe" },
  ])("never fetches with unavailable configuration %#", (configuration) => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(
      // construct only to exercise the configuration boundary
      () =>
        new OpenaiCameraProvider({
          ...configuration,
          fetchImpl,
        })
    ).toThrow("OpenAI camera provider configuration is unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// reject candidate payloads through the complete provider boundary
async function expectInvalidResponse(value: unknown): Promise<void> {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(completedResponse(value));
  await expect(provider(fetchImpl).classify(IMAGES)).rejects.toThrow(
    "OpenAI camera response is invalid"
  );
}

// group inbound provider response cases
describe("OpenAI camera provider response validation", () => {
  // accept lane-scoped and image-wide visibility skips
  it("accepts partial and whole-image visibility results", async () => {
    const results: OpenaiCameraImageResult[] = [
      {
        cameraId: "camera-one",
        visibilityProblems: false,
        lanes: [
          visibleLane("camera-one", "lane-one-front", "low"),
          skippedLane("camera-one", "lane-one-back"),
        ],
      },
      {
        cameraId: "camera-two",
        visibilityProblems: true,
        lanes: [skippedLane("camera-two", "lane-two")],
      },
    ];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(completedResponse({ images: results }));
    await expect(provider(fetchImpl).classify(IMAGES)).resolves.toEqual(
      results
    );
  });

  // reject properties that escaped the strict schema boundary
  it.each([
    { images: VALID_RESULTS, explanation: "private" },
    {
      images: [{ ...VALID_RESULTS[0], confidence: 1 }, VALID_RESULTS[1]],
    },
    {
      images: [
        {
          ...VALID_RESULTS[0],
          lanes: [
            { ...VALID_RESULTS[0].lanes[0], count: 4 },
            VALID_RESULTS[0].lanes[1],
          ],
        },
        VALID_RESULTS[1],
      ],
    },
  ])("rejects additional properties %#", async (value) => {
    await expectInvalidResponse(value);
  });

  // reject unknown, duplicate and missing image identities
  it.each([
    [{ ...VALID_RESULTS[0], cameraId: "unknown-camera" }, VALID_RESULTS[1]],
    [VALID_RESULTS[0], VALID_RESULTS[0]],
    [VALID_RESULTS[0]],
  ])("rejects invalid image cardinality %#", async (images) => {
    await expectInvalidResponse({ images });
  });

  // reject unknown, duplicate and missing lane identities
  it.each([
    [
      { ...VALID_RESULTS[0].lanes[0], laneId: "unknown-lane" },
      VALID_RESULTS[0].lanes[1],
    ],
    [VALID_RESULTS[0].lanes[0], VALID_RESULTS[0].lanes[0]],
    [VALID_RESULTS[0].lanes[0]],
    [
      { ...VALID_RESULTS[0].lanes[0], cameraId: "camera-two" },
      VALID_RESULTS[0].lanes[1],
    ],
  ])("rejects invalid lane cardinality %#", async (lanes) => {
    await expectInvalidResponse({
      images: [{ ...VALID_RESULTS[0], lanes }, VALID_RESULTS[1]],
    });
  });

  // enforce skip nullability and empty-lane motion semantics
  it.each([
    {
      ...VALID_RESULTS[0].lanes[0],
      skippedDueToVisibility: true,
    },
    {
      ...VALID_RESULTS[0].lanes[0],
      occupancyState: null,
      passing: null,
    },
    {
      ...VALID_RESULTS[0].lanes[0],
      occupancyState: "empty",
      passing: true,
    },
    {
      ...VALID_RESULTS[0].lanes[0],
      occupancyState: "majority_full",
    },
  ])("rejects incompatible visible lane values %#", async (lane) => {
    await expectInvalidResponse({
      images: [
        {
          ...VALID_RESULTS[0],
          lanes: [lane, VALID_RESULTS[0].lanes[1]],
        },
        VALID_RESULTS[1],
      ],
    });
  });

  // require image-wide visibility to null every section
  it("rejects classification after an image-wide visibility stop", async () => {
    await expectInvalidResponse({
      images: [
        { ...VALID_RESULTS[0], visibilityProblems: true },
        VALID_RESULTS[1],
      ],
    });
  });

  // normalize provider protocol failures without leaking body details
  it.each([
    new Response("private-http-body", { status: 429 }),
    new Response("not-json", { status: 200 }),
    new Response(
      JSON.stringify({ status: "incomplete", error: null, output: [] }),
      { status: 200 }
    ),
    new Response(
      JSON.stringify({
        status: "completed",
        error: null,
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "private refusal" }],
          },
        ],
      }),
      { status: 200 }
    ),
    new Response(
      JSON.stringify({ status: "completed", error: null, output: [] }),
      { status: 200 }
    ),
    new Response(
      JSON.stringify({
        status: "completed",
        error: null,
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "not-json" }],
          },
        ],
      }),
      { status: 200 }
    ),
  ])("rejects malformed provider responses %#", async (response) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const rejection = provider(fetchImpl).classify(IMAGES);
    await expect(rejection).rejects.toThrow(
      /^OpenAI camera (request failed|response is invalid)$/
    );
    await expect(rejection).rejects.not.toThrow(/private|not-json|429/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  // sanitize transport failures without echoing their causes
  it("rejects a transport failure without retrying", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("private key and provider details"));
    const rejection = provider(fetchImpl).classify(IMAGES);
    await expect(rejection).rejects.toThrow("OpenAI camera request failed");
    await expect(rejection).rejects.not.toThrow(/private|key|details/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

// group provider cancellation cases
describe("OpenAI camera provider cancellation", () => {
  // abort a single attempt when its configured deadline expires
  it("composes a timeout signal without retrying", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(
      // reject only after the provider aborts its request
      (_url, options) =>
        new Promise(
          // keep the mocked request pending until abort
          (_resolve, reject) => {
            // mirror fetch abort behavior in the test double
            options?.signal?.addEventListener("abort", () => {
              reject(new Error("private timeout cause"));
            });
          }
        )
    );
    const pending = provider(fetchImpl, { timeoutMs: 100 }).classify(IMAGES);
    const assertion = expect(pending).rejects.toThrow(
      "OpenAI camera request timed out"
    );
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  // keep the timeout active while reading the provider body
  it("bounds response body reading without retrying", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(
      // return headers while leaving the response body pending
      (_url, options) =>
        Promise.resolve({
          ok: true,
          // reject body reading only after the provider aborts
          json: () =>
            new Promise(
              // keep the mocked body pending until abort
              (_resolve, reject) => {
                // mirror native response body abort behavior
                options?.signal?.addEventListener("abort", () => {
                  reject(new Error("private body timeout cause"));
                });
              }
            ),
        } as Response)
    );
    const pending = provider(fetchImpl, { timeoutMs: 100 }).classify(IMAGES);
    const assertion = expect(pending).rejects.toThrow(
      "OpenAI camera request timed out"
    );
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  // reject valid json returned after an abort-ignoring body timeout
  it("rejects a successful body that resolves after timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve({
        ok: true,
        // resolve valid json only after the request deadline
        json: () =>
          new Promise((resolve) => {
            // simulate an abort-ignoring response body
            setTimeout(
              () => resolve(completedPayload({ images: VALID_RESULTS })),
              200
            );
          }),
      } as Response)
    );
    const pending = provider(fetchImpl, { timeoutMs: 100 }).classify(IMAGES);
    const assertion = expect(pending).rejects.toThrow(
      "OpenAI camera request timed out"
    );
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  // relay caller cancellation through the composed provider signal
  it("composes caller cancellation without retrying", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(
      // reject only after the caller cancellation reaches fetch
      (_url, options) =>
        new Promise(
          // keep the mocked request pending until abort
          (_resolve, reject) => {
            // mirror fetch abort behavior in the test double
            options?.signal?.addEventListener("abort", () => {
              reject(new Error("private caller cause"));
            });
          }
        )
    );
    const pending = provider(fetchImpl).classify(IMAGES, controller.signal);
    const assertion = expect(pending).rejects.toThrow(
      "OpenAI camera request was cancelled"
    );
    controller.abort();
    await assertion;
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  // reject valid json returned after abort-ignoring caller cancellation
  it("rejects a successful body that resolves after caller cancellation", async () => {
    const controller = new AbortController();
    let resolveBody: ((value: unknown) => void) | undefined;
    const body = new Promise<unknown>(
      // expose completion after cancellation for the regression case
      (resolve) => {
        resolveBody = resolve;
      }
    );
    const json = vi.fn(
      // ignore the provider signal while returning a pending body
      () => body
    );
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve({ ok: true, json } as unknown as Response)
    );
    const pending = provider(fetchImpl).classify(IMAGES, controller.signal);
    await vi.waitFor(() => {
      // ensure cancellation occurs during response body reading
      expect(json).toHaveBeenCalledOnce();
    });
    controller.abort();
    resolveBody?.(completedPayload({ images: VALID_RESULTS }));
    await expect(pending).rejects.toThrow(
      "OpenAI camera request was cancelled"
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  // reject an already-cancelled request before network access
  it("does not fetch when the caller is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      provider(fetchImpl).classify(IMAGES, controller.signal)
    ).rejects.toThrow("OpenAI camera request was cancelled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
