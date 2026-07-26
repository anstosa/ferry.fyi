import { beforeEach, describe, expect, it, vi } from "vitest";

const revocations = vi.hoisted(() => ({
  destroy: vi.fn(),
  findByPk: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("~/models/AdminSessionRevocation", () => ({
  AdminSessionRevocation: revocations,
}));

import {
  cleanupExpiredApplicationTokenRevocations,
  hashRevocationSubject,
  isApplicationTokenRevoked,
  revokeApplicationTokens,
} from "../../../server/lib/admin/sessionRevocation";

describe("application token revocation", () => {
  beforeEach(() => {
    process.env.AUTH0_SERVER_SECRET = "test-secret";
    delete process.env.APPLICATION_TOKEN_MAX_AGE_SECONDS;
    revocations.destroy.mockReset().mockResolvedValue(0);
    revocations.findByPk.mockReset();
    revocations.upsert.mockReset().mockResolvedValue(undefined);
  });

  it("stores only a subject HMAC and rejects tokens issued before the action", async () => {
    const now = new Date("2026-07-24T12:00:00.000Z");
    await revokeApplicationTokens("auth0|person", now);

    const subjectHash = hashRevocationSubject("auth0|person")!;
    expect(subjectHash).not.toContain("auth0|person");
    expect(revocations.upsert).toHaveBeenCalledWith({
      expiresAt: new Date("2026-07-25T12:00:00.000Z"),
      revokedAfter: now,
      subjectHash,
    });

    revocations.findByPk.mockResolvedValue({
      expiresAt: new Date("2026-07-25T12:00:00.000Z"),
      revokedAfter: now,
    });
    await expect(
      isApplicationTokenRevoked(
        "auth0|person",
        Math.floor(now.getTime() / 1_000) - 1,
        now
      )
    ).resolves.toBe(true);
    await expect(
      isApplicationTokenRevoked(
        "auth0|person",
        Math.floor(now.getTime() / 1_000) + 1,
        now
      )
    ).resolves.toBe(false);
  });

  it("writes the watermark in a caller-owned deletion transaction", async () => {
    const now = new Date("2026-07-24T12:00:00.000Z");
    const transaction = { id: "user-deletion" } as never;

    await revokeApplicationTokens("auth0|person", now, transaction);

    expect(revocations.upsert).toHaveBeenCalledWith(
      {
        expiresAt: new Date("2026-07-25T12:00:00.000Z"),
        revokedAfter: now,
        subjectHash: hashRevocationSubject("auth0|person"),
      },
      { transaction }
    );
  });

  it("removes expired watermarks and does not reject after expiry", async () => {
    const now = new Date("2026-07-24T12:00:00.000Z");
    revocations.findByPk.mockResolvedValue({
      expiresAt: new Date("2026-07-24T11:59:59.000Z"),
      revokedAfter: now,
    });

    await expect(
      isApplicationTokenRevoked(
        "auth0|person",
        Math.floor(now.getTime() / 1_000) - 1,
        now
      )
    ).resolves.toBe(false);
    expect(revocations.destroy).toHaveBeenCalledWith({
      where: { expiresAt: expect.any(Object) },
    });

    await cleanupExpiredApplicationTokenRevocations(now);
    expect(revocations.destroy).toHaveBeenCalledTimes(2);
  });
});
