import type {
  Crossing,
  CrossingEstimate,
  ForecastFactor,
  Schedule,
  Slot,
  SlotTide,
  SlotWeather,
} from "shared/contracts/schedules";
import type { Vessel } from "shared/contracts/vessels";

type PublicCrossingInput = Crossing;
type PublicEstimateInput = CrossingEstimate;
type PublicSlotInput = Omit<Slot, "crossing" | "estimate"> & {
  crossing?: PublicCrossingInput;
  estimate?: PublicEstimateInput;
};
type PublicScheduleInput = Omit<Schedule, "slots"> & {
  slots: PublicSlotInput[];
};
type PublicScheduleSource =
  | PublicScheduleInput
  | {
      serialize: () => PublicScheduleInput;
      slots?: undefined;
    };

// detect one materialized schedule
const hasPublicScheduleSlots = (
  source: PublicScheduleSource
): source is PublicScheduleInput =>
  Array.isArray((source as PublicScheduleInput).slots);

// normalize cached schedule sources
const getPublicScheduleInput = (
  source: PublicScheduleSource
): PublicScheduleInput => {
  // use an already materialized schedule
  if (hasPublicScheduleSlots(source)) {
    return source;
  }
  return source.serialize();
};

// project one public forecast factor
const toPublicFactor = (factor: ForecastFactor): ForecastFactor => ({
  detail: factor.detail,
  impact: factor.impact,
  label: factor.label,
});

// project one public crossing
export const toPublicCrossing = (crossing: PublicCrossingInput): Crossing => ({
  arrivalId: String(crossing.arrivalId),
  departureDelta: crossing.departureDelta,
  departureId: String(crossing.departureId),
  departureTime: crossing.departureTime,
  driveUpCapacity: crossing.driveUpCapacity,
  hasDriveUp: crossing.hasDriveUp,
  hasReservations: crossing.hasReservations,
  isCancelled: crossing.isCancelled,
  reservableCapacity: crossing.reservableCapacity,
  totalCapacity: crossing.totalCapacity,
  // retain public freshness
  ...(Number.isFinite(crossing.capacityReportUpdatedAt)
    ? { capacityReportUpdatedAt: crossing.capacityReportUpdatedAt }
    : {}),
  ...(crossing.capacityReportUpdatedAt === null
    ? { capacityReportUpdatedAt: null }
    : {}),
  // retain public vessel identity
  ...(crossing.vesselId === null || typeof crossing.vesselId === "string"
    ? { vesselId: crossing.vesselId }
    : {}),
  ...(crossing.vesselName === null || typeof crossing.vesselName === "string"
    ? { vesselName: crossing.vesselName }
    : {}),
});

// project one public estimate
const toPublicEstimate = (estimate: PublicEstimateInput): CrossingEstimate => ({
  driveUpCapacity: estimate.driveUpCapacity,
  reservableCapacity: estimate.reservableCapacity,
  // retain supported estimate metadata
  ...(estimate.confidence ? { confidence: estimate.confidence } : {}),
  ...(estimate.factors
    ? { factors: estimate.factors.map(toPublicFactor) }
    : {}),
  ...(Number.isFinite(estimate.fullProbability)
    ? { fullProbability: estimate.fullProbability }
    : {}),
  ...(estimate.fullRisk ? { fullRisk: estimate.fullRisk } : {}),
  ...(estimate.routeClass ? { routeClass: estimate.routeClass } : {}),
  ...(Number.isFinite(estimate.sampleSize)
    ? { sampleSize: estimate.sampleSize }
    : {}),
  ...(estimate.source ? { source: estimate.source } : {}),
});

// project nested GPS delay details
const toPublicGpsDelay = (gpsDelay: Vessel["gpsDelay"]): Vessel["gpsDelay"] => {
  // omit absent GPS detail
  if (!gpsDelay) {
    return undefined;
  }
  return {
    confidence: gpsDelay.confidence,
    delaySeconds: gpsDelay.delaySeconds,
    explanation: gpsDelay.explanation,
    signals: {
      dockDelaySeconds: gpsDelay.signals.dockDelaySeconds,
      etaDelaySeconds: gpsDelay.signals.etaDelaySeconds,
      progress: gpsDelay.signals.progress,
      scheduledArrivalTime: gpsDelay.signals.scheduledArrivalTime,
      scheduledDepartureTime: gpsDelay.signals.scheduledDepartureTime,
    },
    source: gpsDelay.source,
  };
};

// project one public vessel
const toPublicVessel = (vessel: Vessel): Vessel => ({
  abbreviation: vessel.abbreviation,
  beam: vessel.beam,
  classId: vessel.classId,
  departingTerminalId: vessel.departingTerminalId,
  departedTime: vessel.departedTime,
  departureDelta: vessel.departureDelta,
  dockedTime: vessel.dockedTime,
  estimatedArrivalTime: vessel.estimatedArrivalTime,
  hasCarDeckRestroom: vessel.hasCarDeckRestroom,
  hasElevator: vessel.hasElevator,
  hasGalley: vessel.hasGalley,
  hasRestroom: vessel.hasRestroom,
  hasWiFi: vessel.hasWiFi,
  heading: vessel.heading,
  horsepower: vessel.horsepower,
  id: vessel.id,
  inMaintenance: vessel.inMaintenance,
  inService: vessel.inService,
  info: {
    // retain supported vessel details
    ...(vessel.info?.ada ? { ada: vessel.info.ada } : {}),
    ...(vessel.info?.crossing ? { crossing: vessel.info.crossing } : {}),
  },
  isAdaAccessible: vessel.isAdaAccessible,
  length: vessel.length,
  maxClearance: vessel.maxClearance,
  mmsi: vessel.mmsi,
  name: vessel.name,
  passengerCapacity: vessel.passengerCapacity,
  speed: vessel.speed,
  tallVehicleCapacity: vessel.tallVehicleCapacity,
  vesselWatchUrl: vessel.vesselWatchUrl,
  vehicleCapacity: vessel.vehicleCapacity,
  weight: vessel.weight,
  yearBuilt: vessel.yearBuilt,
  // retain supported live vessel state
  ...(Number.isFinite(vessel.arrivingTerminalId)
    ? { arrivingTerminalId: vessel.arrivingTerminalId }
    : {}),
  ...(Number.isFinite(vessel.scheduledDepartureTime)
    ? { scheduledDepartureTime: vessel.scheduledDepartureTime }
    : {}),
  ...(toPublicGpsDelay(vessel.gpsDelay)
    ? { gpsDelay: toPublicGpsDelay(vessel.gpsDelay) }
    : {}),
  ...(typeof vessel.isAtDock === "boolean"
    ? { isAtDock: vessel.isAtDock }
    : {}),
  ...(vessel.location
    ? {
        location: {
          latitude: vessel.location.latitude,
          longitude: vessel.location.longitude,
        },
      }
    : {}),
  ...(Number.isFinite(vessel.yearRebuilt)
    ? { yearRebuilt: vessel.yearRebuilt }
    : {}),
});

// project one public tide snapshot
const toPublicTide = (tide: SlotTide): SlotTide => ({
  stationId: tide.stationId,
  waterLevelM: tide.waterLevelM,
  // retain supported tide context
  ...(tide.arrivalStationId ? { arrivalStationId: tide.arrivalStationId } : {}),
  ...(tide.arrivalWaterLevelM === null ||
  Number.isFinite(tide.arrivalWaterLevelM)
    ? { arrivalWaterLevelM: tide.arrivalWaterLevelM }
    : {}),
  ...(tide.lowestWaterLevelM === null || Number.isFinite(tide.lowestWaterLevelM)
    ? { lowestWaterLevelM: tide.lowestWaterLevelM }
    : {}),
});

// project one public weather snapshot
const toPublicWeather = (weather: SlotWeather): SlotWeather => ({
  cloudCoverPercent: weather.cloudCoverPercent,
  highTemperatureC: weather.highTemperatureC,
  precipitationMm: weather.precipitationMm,
  temperatureC: weather.temperatureC,
  windGustKmh: weather.windGustKmh,
  windSpeedKmh: weather.windSpeedKmh,
});

// project one public schedule slot
export const toPublicSlot = (slot: PublicSlotInput): Slot => ({
  allowsPassengers: slot.allowsPassengers,
  allowsVehicles: slot.allowsVehicles,
  hasPassed: slot.hasPassed,
  mateId: slot.mateId,
  time: slot.time,
  vessel: toPublicVessel(slot.vessel),
  wuid: slot.wuid,
  // retain supported optional slot fields
  ...(Number.isFinite(slot.arrivalTime)
    ? { arrivalTime: slot.arrivalTime }
    : {}),
  ...(slot.cancellationReason
    ? { cancellationReason: slot.cancellationReason }
    : {}),
  ...(slot.crossing ? { crossing: toPublicCrossing(slot.crossing) } : {}),
  ...(slot.estimate ? { estimate: toPublicEstimate(slot.estimate) } : {}),
  ...(slot.tide ? { tide: toPublicTide(slot.tide) } : {}),
  ...(Number.isFinite(slot.vesselPosition)
    ? { vesselPosition: slot.vesselPosition }
    : {}),
  ...(slot.weather ? { weather: toPublicWeather(slot.weather) } : {}),
});

// project one public schedule
export const toPublicSchedule = (source: PublicScheduleSource): Schedule => {
  const schedule = getPublicScheduleInput(source);
  return {
    date: schedule.date,
    key: schedule.key,
    mateId: schedule.mateId,
    slots: schedule.slots.map(toPublicSlot),
    terminalId: schedule.terminalId,
    validRange: schedule.validRange
      ? { from: schedule.validRange.from, to: schedule.validRange.to }
      : null,
    // retain public source freshness
    ...(Number.isFinite(schedule.sourceUpdatedAt) ||
    schedule.sourceUpdatedAt === null
      ? { sourceUpdatedAt: schedule.sourceUpdatedAt }
      : {}),
  };
};
