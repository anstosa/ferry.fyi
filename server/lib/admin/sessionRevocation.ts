import { createHmac } from "crypto";
import { Op, type Transaction } from "sequelize";

const defaultTokenLifetimeSeconds = 86_400;

const getTokenLifetimeMilliseconds = (): number => {
  const configured = Number(process.env.APPLICATION_TOKEN_MAX_AGE_SECONDS);
  const seconds =
    Number.isSafeInteger(configured) && configured > 0
      ? configured
      : defaultTokenLifetimeSeconds;
  return seconds * 1_000;
};

const getHashSecret = (): string | undefined => process.env.AUTH0_SERVER_SECRET;

/** Returns undefined when server credentials are not configured. */
export const hashRevocationSubject = (subject: string): string | undefined => {
  const secret = getHashSecret();
  if (!secret) {
    return undefined;
  }
  return createHmac("sha256", secret).update(subject).digest("hex");
};

export interface ApplicationRevocationResult {
  expiresAt: string;
  status: "complete";
}

/**
 * Invalidates application JWTs issued at or before this action. The stored
 * value expires after the maximum accepted application-token lifetime.
 */
export const revokeApplicationTokens = async (
  subject: string,
  now = new Date(),
  transaction?: Transaction
): Promise<ApplicationRevocationResult> => {
  const subjectHash = hashRevocationSubject(subject);
  if (!subjectHash) {
    throw new Error("Application token revocation is not configured");
  }
  const expiresAt = new Date(now.getTime() + getTokenLifetimeMilliseconds());
  const { AdminSessionRevocation } =
    await import("~/models/AdminSessionRevocation");
  const values = {
    expiresAt,
    revokedAfter: now,
    subjectHash,
  };
  if (transaction) {
    await AdminSessionRevocation.upsert(values, { transaction });
  } else {
    await AdminSessionRevocation.upsert(values);
  }
  return { expiresAt: expiresAt.toISOString(), status: "complete" };
};

/** Removes expired tombstones; safe to call lazily from authenticated traffic. */
export const cleanupExpiredApplicationTokenRevocations = (
  now = new Date()
): Promise<number> =>
  import("~/models/AdminSessionRevocation").then(({ AdminSessionRevocation }) =>
    AdminSessionRevocation.destroy({ where: { expiresAt: { [Op.lte]: now } } })
  );

/** True only when the validated JWT was issued after the current watermark. */
export const isApplicationTokenRevoked = async (
  subject: string,
  issuedAtSeconds: number,
  now = new Date()
): Promise<boolean> => {
  const subjectHash = hashRevocationSubject(subject);
  if (!subjectHash) {
    return false;
  }
  await cleanupExpiredApplicationTokenRevocations(now);
  const { AdminSessionRevocation } =
    await import("~/models/AdminSessionRevocation");
  const revocation = await AdminSessionRevocation.findByPk(subjectHash);
  if (!revocation || revocation.expiresAt.getTime() <= now.getTime()) {
    return false;
  }
  return issuedAtSeconds * 1_000 <= revocation.revokedAfter.getTime();
};
