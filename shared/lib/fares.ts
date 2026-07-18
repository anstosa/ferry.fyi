import {
  FareSourceValidation,
  WsdotFareLineItemResponse,
  WsdotFareTotalResponse,
} from "../contracts/fares";

const hasString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const hasNonNegativeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const hasPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0;

const hasWsdotFareLineItemShape = (
  value: unknown
): value is WsdotFareLineItemResponse => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    hasNonNegativeNumber(item.Amount) &&
    hasString(item.Category) &&
    typeof item.DirectionIndependent === "boolean" &&
    hasString(item.FareLineItem) &&
    hasPositiveInteger(item.FareLineItemID)
  );
};

const hasWsdotFareTotalShape = (
  value: unknown
): value is WsdotFareTotalResponse => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const total = value as Record<string, unknown>;
  return (
    hasNonNegativeNumber(total.Amount) &&
    hasString(total.BriefDescription) &&
    hasString(total.Description) &&
    ["Depart", "Either", "Return", "Total"].includes(total.TotalType as string)
  );
};

/** Validates the documented array response from WSDOT farelineitems. */
export const validateWsdotFareLineItems = (
  value: unknown
): FareSourceValidation<WsdotFareLineItemResponse[]> => {
  if (!Array.isArray(value)) {
    return {
      errors: ["Expected an array of WSDOT fare line items."],
      ok: false,
    };
  }

  const invalidIndex = value.findIndex(
    (item) => !hasWsdotFareLineItemShape(item)
  );
  return invalidIndex === -1
    ? { ok: true, value }
    : {
        errors: [
          `Fare line item at index ${invalidIndex} does not match WSDOT's documented shape.`,
        ],
        ok: false,
      };
};

/** Validates the documented array response from WSDOT faretotals. */
export const validateWsdotFareTotals = (
  value: unknown
): FareSourceValidation<WsdotFareTotalResponse[]> => {
  if (!Array.isArray(value)) {
    return { errors: ["Expected an array of WSDOT fare totals."], ok: false };
  }

  const invalidIndex = value.findIndex((item) => !hasWsdotFareTotalShape(item));
  return invalidIndex === -1
    ? { ok: true, value }
    : {
        errors: [
          `Fare total at index ${invalidIndex} does not match WSDOT's documented shape.`,
        ],
        ok: false,
      };
};

const CREDENTIAL_KEY_PATTERN = /^(apiaccesscode|authorization|wsdot_api_key)$/i;

/** Rejects fixture objects that would expose an upstream credential or auth header. */
export const validateRedactedWsdotFareFixture = (
  value: unknown
): FareSourceValidation<unknown> => {
  const forbiddenPaths: string[] = [];

  const visit = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (current === null || typeof current !== "object") {
      return;
    }

    Object.entries(current).forEach(([key, child]) => {
      const childPath = path ? `${path}.${key}` : key;
      if (CREDENTIAL_KEY_PATTERN.test(key)) {
        forbiddenPaths.push(childPath);
      }
      visit(child, childPath);
    });
  };

  visit(value, "");
  return forbiddenPaths.length === 0
    ? { ok: true, value }
    : {
        errors: forbiddenPaths.map(
          (path) => `Fixture contains a credential-bearing field at ${path}.`
        ),
        ok: false,
      };
};
