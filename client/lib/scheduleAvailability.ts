export type TransientScheduleStatus = "refreshing" | "warming";

// transient schedule status guard
const isTransientScheduleStatus = (
  value: unknown
): value is TransientScheduleStatus =>
  value === "refreshing" || value === "warming";

// read one direct or enveloped transient schedule status
export const getTransientScheduleStatus = (
  value: unknown
): TransientScheduleStatus | null => {
  // response object guard
  if (!value || typeof value !== "object") {
    return null;
  }
  const status = "status" in value ? value.status : undefined;
  // direct status guard
  if (isTransientScheduleStatus(status)) {
    return status;
  }
  const body = "body" in value ? value.body : undefined;
  // envelope body guard
  if (!body || typeof body !== "object" || !("status" in body)) {
    return null;
  }
  return isTransientScheduleStatus(body.status) ? body.status : null;
};
