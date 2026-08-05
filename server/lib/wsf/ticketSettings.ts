import {
  TICKET_LOOKUP_USER_AGENT_PROFILES,
  type TicketLookupAdminSettings,
  type TicketLookupUserAgentProfileId,
} from "shared/contracts/tickets";
import { isObject } from "shared/lib/objects";

import { TicketLookupControl } from "~/models/TicketLookupControl";

export const TICKET_LOOKUP_CACHE_TTL_SECONDS = 30 * 60;
const CONTROL_KEY = "wave2go";
const DEFAULT_PROFILE_ID: TicketLookupUserAgentProfileId = "identified-contact";

// profile identifier guard
const isProfileId = (value: unknown): value is TicketLookupUserAgentProfileId =>
  typeof value === "string" &&
  TICKET_LOOKUP_USER_AGENT_PROFILES.some(({ id }) => id === value);

// singleton control lookup
const getControl = async (): Promise<TicketLookupControl> => {
  const [control] = await TicketLookupControl.findOrCreate({
    defaults: {
      key: CONTROL_KEY,
      userAgentProfile: DEFAULT_PROFILE_ID,
    },
    where: { key: CONTROL_KEY },
  });
  return control;
};

// public settings projection
const projectSettings = (
  control: TicketLookupControl
): TicketLookupAdminSettings => {
  const selectedUserAgentProfile = isProfileId(control.userAgentProfile)
    ? control.userAgentProfile
    : DEFAULT_PROFILE_ID;
  return {
    cacheTtlSeconds: TICKET_LOOKUP_CACHE_TTL_SECONDS,
    selectedUserAgentProfile,
    userAgentProfiles: TICKET_LOOKUP_USER_AGENT_PROFILES,
  };
};

// load public settings
export const getTicketLookupSettings =
  async (): Promise<TicketLookupAdminSettings> => {
    return projectSettings(await getControl());
  };

// selected user agent lookup
export const getTicketLookupUserAgent = async (): Promise<string> => {
  const settings = await getTicketLookupSettings();
  return (
    settings.userAgentProfiles.find(
      ({ id }) => id === settings.selectedUserAgentProfile
    ) ?? settings.userAgentProfiles[0]
  ).userAgent;
};

// validated settings update
export const saveTicketLookupSettings = async (
  value: unknown
): Promise<TicketLookupAdminSettings> => {
  // payload guard
  if (!isObject(value) || !isProfileId(value.selectedUserAgentProfile)) {
    throw new Error("Invalid ticket lookup settings");
  }
  const control = await getControl();
  await control.update({
    userAgentProfile: value.selectedUserAgentProfile,
  });
  return projectSettings(control);
};
