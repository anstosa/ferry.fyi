// format the age of a source update or image check
export const formatUpdatedAt = (
  sourceUpdatedAt: number | null | undefined,
  now: number,
  labelPrefix = "Updated"
): string | null => {
  // unknown source instants remain unknown
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
    ? `${labelPrefix} just now`
    : `${labelPrefix} ${minutesAgo} min${minutesAgo === 1 ? "" : "s"} ago`;
};
