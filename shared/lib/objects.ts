import { isEmpty } from "./arrays";
// eslint-disable-next-line @typescript-eslint/ban-types
export const isObject = (input: unknown): input is object =>
  typeof input === "object" && input !== null;

export const findKey = (
  object: Record<string, unknown>,
  targetValue: unknown
): string | undefined => {
  for (const [key, value] of entries(object)) {
    if (value === targetValue) {
      return key;
    }
  }
};

// eslint-disable-next-line @typescript-eslint/ban-types
export const isKeyof = <T extends object>(
  object: T,
  possibleKey: keyof any
): possibleKey is keyof T => possibleKey in object;

// eslint-disable-next-line @typescript-eslint/ban-types
export const omit = <T extends object, K extends keyof T>(
  object: T,
  key: K
): Omit<T, K> => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [key]: _, ...result } = object;
  return result;
};

/**
 * Utility to setting values in nested Record<string | number, *> objects
 * Recursively dives into object along path, creating new intermediate objects
 * as necessary until it can set value
 **/
export const setNested = (
  object: Record<string | number, any>,
  path: Array<string | number>,
  value: unknown
): void => {
  const [nextKey, ...keys] = path;
  if (isEmpty(keys)) {
    object[nextKey] = value;
    return;
  }
  if (!(nextKey in object)) {
    object[nextKey] = {};
  }
  return setNested(object[nextKey], keys, value);
};

// TypeScript chooses not use generic types for Object.* utility methods
// I think that's dumb so here we are...
// https://github.com/microsoft/TypeScript/pull/12253#issuecomment-263132208

export const keys = Object.keys as <T>(object: T) => Extract<keyof T, string>[];

export const entries = Object.entries as <T>(
  object: T
) => T extends ArrayLike<infer U>
  ? [string, U][]
  : { [K in keyof T]: [K, T[K]] }[keyof T][];

export const values = Object.values as <T>(
  object: T
) => T extends ArrayLike<infer U> ? U[] : T[keyof T][];
