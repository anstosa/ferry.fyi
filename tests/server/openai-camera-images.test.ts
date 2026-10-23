import { describe, expect, it, vi } from "vitest";

import { OpenaiCameraImageClient } from "../../server/lib/openaiCameraImages";
import { getOpenaiCameraDefinitions } from "../../server/lib/openaiCameraPlanning";

const definition = getOpenaiCameraDefinitions()[0];
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");

// build the bounded native-scale processor contract
const prepared = () => ({
  imageBase64: png,
  fingerprint: "a".repeat(64),
  width: 300,
  height: 90,
  sourceWidth: definition.config.frameSize.width,
  sourceHeight: definition.config.frameSize.height,
  rotationDegrees: 17,
  laneIds: definition.config.allowedAreas.map(({ id }) => id),
});

// expose canonical image and processor responses without a real camera
const setup = (processorBody: unknown = prepared()) => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "content-type": "image/jpeg",
          "last-modified": "Fri, 23 Oct 2026 10:00:00 GMT",
          etag: "source-1",
        },
      })
    )
    .mockResolvedValueOnce(Response.json(processorBody));
  return {
    fetchImpl,
    client: new OpenaiCameraImageClient({
      endpoint: "http://processor/prepare",
      fetchImpl,
    }),
  };
};

// verify server-side image preparation remains private, bounded and identity-safe
describe("OpenAI camera image adapter", () => {
  // keep the configured source and every reviewed mask aligned
  it("posts masks and source geometry to the non-inference processor", async () => {
    const { client, fetchImpl } = setup();
    const frame = await client.prepare(
      definition,
      new AbortController().signal
    );
    expect(frame.image).toMatchObject({
      ...prepared(),
      cameraId: definition.cameraId,
    });
    expect(frame.frameToken).toMatch(/^[a-f0-9]{64}$/);
    expect(frame.frameUpdatedAt).toBe(Date.parse("2026-10-23T10:00:00Z"));
    const [url, options] = fetchImpl.mock.calls[1];
    expect(url).toBe("http://processor/prepare");
    expect(options.method).toBe("POST");
    expect(options.redirect).toBe("error");
    expect(options.headers["X-Camera-Id"]).toBe(definition.cameraId);
    expect(JSON.parse(options.headers["X-Detection-Areas"])).toEqual({
      allowedAreas: definition.config.allowedAreas,
      excludedAreas: definition.config.excludedAreas,
      frameSize: definition.config.frameSize,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // reject source substitutions before performing any request
  it("rejects non-WSDOT images and credential-bearing processor URLs", async () => {
    const { client, fetchImpl } = setup();
    await expect(
      client.prepare(
        {
          ...definition,
          config: {
            ...definition.config,
            imageUrl: "http://127.0.0.1/private",
          },
        },
        new AbortController().signal
      )
    ).rejects.toThrow("WSDOT");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      () =>
        new OpenaiCameraImageClient({
          endpoint: "http://secret:password@processor/prepare",
        })
    ).toThrow();
  });

  // reject malformed identity, binary and geometry before paid inference
  it.each([
    { ...prepared(), laneIds: [] },
    { ...prepared(), laneIds: ["unknown-section"] },
    { ...prepared(), fingerprint: "invalid" },
    { ...prepared(), width: 0 },
    { ...prepared(), imageBase64: "bm90LWEtcG5n" },
  ])("rejects malformed prepared images %j", async (body) => {
    const { client } = setup(body);
    await expect(
      client.prepare(definition, new AbortController().signal)
    ).rejects.toThrow("Malformed");
  });

  // cap raw image bytes even when the trusted upstream advertises a bad payload
  it("rejects oversized source bodies before contacting the processor", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("large", {
        headers: { "content-length": String(9 * 1024 * 1024) },
      })
    );
    const client = new OpenaiCameraImageClient({
      endpoint: "http://processor/prepare",
      fetchImpl,
    });
    await expect(
      client.prepare(definition, new AbortController().signal)
    ).rejects.toThrow("size limit");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
