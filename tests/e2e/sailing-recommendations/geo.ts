import { fixtureAudit, recordLocationRequest } from "./state";

// emulate one user-triggered foreground location request
export const requestForegroundLocation = async (): Promise<{
  latitude: number;
  longitude: number;
} | null> => {
  recordLocationRequest();
  await Promise.resolve();
  // exercise denial without ever invoking the browser geolocation api
  if (fixtureAudit.scenario === "denied") {
    return null;
  }
  return { latitude: 47.9501, longitude: -122.3001 };
};
