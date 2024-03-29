export const isString = (input: unknown): input is string =>
  typeof input === "string" || input instanceof String;

export const capitalize = (input: string): string =>
  input.charAt(0).toUpperCase() + input.slice(1);

export const pluralize = (
  count: number,
  noun: string,
  suffix: string = "s"
): string => `${count} ${noun}${count === 1 ? "" : suffix}`;
