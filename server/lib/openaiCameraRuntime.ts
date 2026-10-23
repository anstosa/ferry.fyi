import { createHash } from "node:crypto";

import { getProjectedTiming } from "shared/lib/projectedTiming";

import { Schedule } from "~/models/Schedule";

import { OpenaiCameraImageClient } from "./openaiCameraImages";
import {
  type OpenaiCameraDeparture,
  OpenaiCameraPipeline,
} from "./openaiCameraPipeline";
import { getOpenaiCameraDefinitions } from "./openaiCameraPlanning";
import {
  OPENAI_CAMERA_PROMPT,
  OPENAI_CAMERA_PROMPT_VERSION,
} from "./openaiCameraPrompt";
import { OpenaiCameraProvider } from "./openaiCameraProvider";
import { databaseOpenaiCameraStore } from "./openaiCameraStore";
import type {
  OpenaiCameraDefinition,
  OpenaiCameraPipelineState,
} from "./openaiCameraTypes";

const REQUIRED_CONFIGURATION = [
  "OPENAI_CAMERA_API_KEY",
  "OPENAI_CAMERA_MODEL",
  "OPENAI_CAMERA_PREPROCESSOR_ENDPOINT",
] as const;

// invalidate stored classifications whenever actual prompt text or geometry changes
export const getOpenaiCameraInferenceKey = (
  model: string,
  detail: string,
  definitions: OpenaiCameraDefinition[],
  prompt = OPENAI_CAMERA_PROMPT
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        model,
        detail,
        prompt,
        promptVersion: OPENAI_CAMERA_PROMPT_VERSION,
        definitions,
      })
    )
    .digest("hex");

// expose configuration readiness without returning any credential
export const getOpenaiCameraConfiguration = () => {
  const missingConfiguration: string[] = REQUIRED_CONFIGURATION.filter(
    (name) => !process.env[name]?.trim()
  );
  const enabled = process.env.OPENAI_CAMERA_ENABLED === "true";
  const detail = process.env.OPENAI_CAMERA_IMAGE_DETAIL ?? "auto";
  // fail closed for unsupported detail settings before scheduling work
  if (!["auto", "low", "high", "original"].includes(detail)) {
    missingConfiguration.push("OPENAI_CAMERA_IMAGE_DETAIL");
  }
  return {
    enabled,
    configured: missingConfiguration.length === 0,
    active: enabled && missingConfiguration.length === 0,
    missingConfiguration,
    model: process.env.OPENAI_CAMERA_MODEL?.trim() || null,
    detail,
  };
};

// use the existing server projection including delayed sailings across service-day rollover
export const getOpenaiCameraDepartures = (): OpenaiCameraDeparture[] => {
  const departures: OpenaiCameraDeparture[] = [];
  // cached schedules include any carried-over delayed departure
  for (const schedule of Object.values(Schedule.getAll())) {
    // preserve each vessel's complete schedule when projecting recovery
    for (const slot of schedule.slots) {
      const timing = getProjectedTiming({ schedule: schedule.slots, slot });
      departures.push({
        terminalId: schedule.terminalId,
        predictedDepartureAt: timing.departureTime.toMillis(),
        allowsVehicles: slot.allowsVehicles,
        isCancelled: timing.isCancelled || Boolean(slot.cancellationReason),
      });
    }
  }
  return departures;
};

// return private cached evidence without triggering source or provider requests
export const getOpenaiCameraStatus = async () => {
  let state: OpenaiCameraPipelineState | null = null;
  let storageAvailable = true;
  try {
    state = await databaseOpenaiCameraStore.read();
  } catch {
    // deployments without the new migration remain inspectable and disabled by default
    storageAvailable = false;
  }
  return {
    ...getOpenaiCameraConfiguration(),
    prompt: OPENAI_CAMERA_PROMPT,
    promptVersion: OPENAI_CAMERA_PROMPT_VERSION,
    storageAvailable,
    state,
    // publish only reviewed camera and section metadata to the authenticated owner
    cameras: getOpenaiCameraDefinitions().map(
      ({ cameraId, terminalId, order, markerId, physicalLanes }) => ({
        cameraId,
        terminalId,
        order,
        markerId,
        physicalLanes,
      })
    ),
  };
};

// execute only through the named owner-operation lease and explicit dedicated configuration
export const refreshOpenaiCameraPipeline = async (): Promise<void> => {
  const configuration = getOpenaiCameraConfiguration();
  // never borrow another feature's key or choose an unevaluated default model
  if (!configuration.active) {
    return;
  }
  const definitions = getOpenaiCameraDefinitions();
  const client = new OpenaiCameraImageClient({
    endpoint: process.env.OPENAI_CAMERA_PREPROCESSOR_ENDPOINT!.trim(),
  });
  const provider = new OpenaiCameraProvider({
    apiKey: process.env.OPENAI_CAMERA_API_KEY!.trim(),
    model: configuration.model!,
    detail: configuration.detail as "auto" | "low" | "high" | "original",
  });
  const inferenceKey = getOpenaiCameraInferenceKey(
    configuration.model!,
    configuration.detail,
    definitions
  );
  const pipeline = new OpenaiCameraPipeline({
    definitions,
    store: databaseOpenaiCameraStore,
    inferenceKey,
    // keep raw image bytes transient and outside durable state
    prepare: (definition, signal) => client.prepare(definition, signal),
    // submit one shared prompt at a time without inline retries
    classify: (images, signal) => provider.classify(images, signal),
    getDepartures: getOpenaiCameraDepartures,
  });
  await pipeline.run();
};
