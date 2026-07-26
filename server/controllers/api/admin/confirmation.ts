import { timingSafeEqual } from "crypto";
import { NextFunction, Request, RequestHandler, Response } from "express";
import {
  AdminConfirmationAction,
  adminConfirmationActions,
  AdminConfirmationPayload,
} from "shared/contracts/admin";
import { isObject } from "shared/lib/objects";

const confirmationError = { error: "Invalid typed confirmation" };
const maxConfirmationLength = 300;
const canonicalTargetPattern = /^[a-z][a-z0-9-]*:[A-Za-z0-9|_.:-]+$/;

export interface TypedConfirmationOptions {
  action: AdminConfirmationAction;
  /**
   * Resolve this from route parameters or a trusted resource lookup, never
   * from the request body. This keeps the phrase tied to the actual mutation.
   */
  getTarget: (request: Request) => string | undefined;
}

const isAction = (input: unknown): input is AdminConfirmationAction =>
  typeof input === "string" &&
  (adminConfirmationActions as readonly string[]).includes(input);

const normalizePhrase = (input: string): string =>
  input.normalize("NFKC").trim().replace(/\s+/g, " ");

const isCanonicalTarget = (target: string): boolean =>
  target.length <= maxConfirmationLength &&
  canonicalTargetPattern.test(target) &&
  normalizePhrase(target) === target;

/**
 * Returns the single phrase accepted for an allowlisted action and canonical
 * target. Undefined means the operation/target combination is not safe to
 * expose for confirmation.
 */
export const getAdminConfirmationPhrase = (
  action: AdminConfirmationAction,
  target: string
): string | undefined => {
  if (!isCanonicalTarget(target)) {
    return undefined;
  }
  return `CONFIRM ${action} ${target}`;
};

const equalPhrases = (provided: string, expected: string): boolean => {
  const providedBuffer = Buffer.from(normalizePhrase(provided));
  const expectedBuffer = Buffer.from(normalizePhrase(expected));
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
};

const isConfirmationPayload = (
  input: unknown
): input is AdminConfirmationPayload =>
  isObject(input) &&
  isAction(input.action) &&
  typeof input.target === "string" &&
  typeof input.confirmation === "string" &&
  input.confirmation.length <= maxConfirmationLength;

/**
 * Rejects untyped, malformed, mismatched, or non-canonical confirmations.
 * It deliberately neither logs nor stores the request payload or phrase.
 */
export const requireTypedConfirmation =
  ({ action, getTarget }: TypedConfirmationOptions): RequestHandler =>
  (request: Request, response: Response, next: NextFunction): void => {
    const expectedTarget = getTarget(request);
    const expectedPhrase =
      typeof expectedTarget === "string"
        ? getAdminConfirmationPhrase(action, expectedTarget)
        : undefined;

    if (
      !expectedPhrase ||
      !isConfirmationPayload(request.body) ||
      request.body.action !== action ||
      request.body.target !== expectedTarget ||
      !equalPhrases(request.body.confirmation, expectedPhrase)
    ) {
      response.status(400).send(confirmationError);
      return;
    }

    // Do not carry the typed phrase into a domain handler where it could be
    // accidentally logged or persisted. Only the verified metadata survives.
    const { confirmation: _confirmation, ...safeBody } = request.body;
    request.body = safeBody;
    response.locals.adminConfirmation = { action, target: expectedTarget };
    next();
  };
