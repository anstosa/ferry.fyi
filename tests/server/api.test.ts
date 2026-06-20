import { describe, expect, it, vi } from "vitest";
import { getWsfStatus } from "../../server/lib/wsf/api";
import { Response } from "express";
import { sendResponse } from "../../server/lib/api";

// api seam
describe("sendResponse", () => {
  // response envelope
  it("wraps response bodies with WSF status", () => {
    const send = vi.fn();
    const response = { send } as unknown as Response;
    const body = { ok: true };

    sendResponse(response, body);

    expect(send).toHaveBeenCalledWith({
      body,
      wsfStatus: getWsfStatus(),
    });
  });
});
