/**
 * Formats an epoch-second source timestamp for the freshness UI.
 */
export const formatUpdatedAt = (
  sourceUpdatedAt: number | null | undefined,
  now: number,
  verb = "Updated"
): string | null => {
  if (
    sourceUpdatedAt === null ||
    sourceUpdatedAt === undefined ||
    !Number.isFinite(sourceUpdatedAt) ||
    !Number.isFinite(now)
  ) {
    return null;
  }

  const minutesAgo = Math.floor(Math.max(0, now - sourceUpdatedAt) / 60);

  return minutesAgo === 0
    ? `${verb} just now`
    : `${verb} ${minutesAgo} min${minutesAgo === 1 ? "" : "s"} ago`;
};
