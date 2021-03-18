export const findKey = (
  object: Record<string, unknown>,
  targetValue: unknown
): string | undefined => {
  const entries = Object.entries(object);
  for (const [key, value] of entries) {
    if (value === targetValue) {
      return key;
    }
  }
};
