export const isNull = (input: unknown): input is null => input === null;

export const isUndefined = (input: unknown): input is undefined =>
  input === undefined;

export const isNil = (input: unknown): input is undefined | null =>
  isNull(input) || isUndefined(input);
