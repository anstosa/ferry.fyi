const SLOT_MINUTES = 5;

export const OPENAI_CAMERA_SLOT_MS = SLOT_MINUTES * 60_000;

// derive clock-aligned minute marks from the shared cost cadence
export const OPENAI_CAMERA_SCHEDULE_MINUTES = Array.from(
  { length: 60 / SLOT_MINUTES },
  // retain whole-minute scheduling at every slot boundary
  (_, index) => index * SLOT_MINUTES
);
