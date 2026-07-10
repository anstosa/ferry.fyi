import type {
  CameraAreaVehicleCount,
  CameraDetectionArea,
  CameraDetectionCameraConfig,
  CameraDetectionPoint,
  CameraLineDetectionResult,
  CameraLineVehicleDetection,
  VehicleDetection,
  VehicleDetectionBox,
} from "shared/contracts/cameraDetection";

const VEHICLE_LABELS = new Set(["bus", "car", "motorcycle", "truck", "van"]);

// bound a value
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

// cap a filled-space percentage
const getOccupancyPercent = (vehicleCount: number, capacity: number): number =>
  Math.min(100, (vehicleCount / capacity) * 100);

// normalize detection center
export const getDetectionCenter = (
  box: VehicleDetectionBox
): CameraDetectionPoint => [
  clamp(box.x + box.width / 2, 0, 1),
  clamp(box.y + box.height / 2, 0, 1),
];

// test point inclusion
export const isPointInPolygon = (
  point: CameraDetectionPoint,
  polygon: CameraDetectionPoint[]
): boolean => {
  let isInside = false;
  // polygon edge scan
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const [currentX, currentY] = polygon[index];
    const [previousX, previousY] = polygon[previous];
    const crossesY = currentY > point[1] !== previousY > point[1];
    // ray-crossing guard
    if (!crossesY) {
      continue;
    }
    const crossingX =
      ((previousX - currentX) * (point[1] - currentY)) /
        (previousY - currentY || Number.EPSILON) +
      currentX;
    // crossing side guard
    if (point[0] < crossingX) {
      isInside = !isInside;
    }
  }
  return isInside;
};

// validate label class
export const isVehicleDetection = (detection: VehicleDetection): boolean => {
  const label = detection.label.toLowerCase();
  return VEHICLE_LABELS.has(label);
};

// test detection in area
export const isDetectionInArea = (
  detection: VehicleDetection,
  area: CameraDetectionArea
): boolean => isPointInPolygon(getDetectionCenter(detection.box), area.polygon);

// collect containing areas
const getContainingAreaIds = (
  detection: VehicleDetection,
  areas: CameraDetectionArea[]
): string[] => {
  const areaIds: string[] = [];
  // area scan
  for (const area of areas) {
    // inclusion guard
    if (isDetectionInArea(detection, area)) {
      areaIds.push(area.id);
    }
  }
  return areaIds;
};

// test detection in any area
const isDetectionInAnyArea = (
  detection: VehicleDetection,
  areas: CameraDetectionArea[]
): boolean => getContainingAreaIds(detection, areas).length > 0;

// classify detections by configured areas
export const classifyCameraDetections = (
  config: CameraDetectionCameraConfig,
  detections: VehicleDetection[]
): CameraLineVehicleDetection[] => {
  return detections.filter(isVehicleDetection).map((detection) => {
    const allowedAreaIds = getContainingAreaIds(detection, config.allowedAreas);
    const excludedAreaIds = getContainingAreaIds(
      detection,
      config.excludedAreas
    );
    let disposition: CameraLineVehicleDetection["disposition"] = "outside";
    // exclusion guard
    if (excludedAreaIds.length > 0) {
      disposition = "excluded";
    } else if (allowedAreaIds.length > 0) {
      disposition = "included";
    }
    return {
      ...detection,
      allowedAreaIds,
      center: getDetectionCenter(detection.box),
      disposition,
      excludedAreaIds,
    };
  });
};

// count detections by configured areas
export const countCameraDetections = (
  cameraId: string,
  config: CameraDetectionCameraConfig,
  detections: VehicleDetection[],
  includeDetections = false
): CameraLineDetectionResult => {
  const classifiedDetections = classifyCameraDetections(config, detections);
  const excludedDetections = classifiedDetections.filter((detection) =>
    isDetectionInAnyArea(detection, config.excludedAreas)
  );
  const includedDetections = classifiedDetections.filter((detection) => {
    // exclusion guard
    if (isDetectionInAnyArea(detection, config.excludedAreas)) {
      return false;
    }
    return isDetectionInAnyArea(detection, config.allowedAreas);
  });
  const areaCounts: CameraAreaVehicleCount[] = config.allowedAreas.map(
    (area) => {
      const vehicleCount = includedDetections.filter((detection) =>
        isDetectionInArea(detection, area)
      ).length;
      const { vehicleCapacity } = area;
      const hasVehicleCapacity =
        typeof vehicleCapacity === "number" &&
        Number.isFinite(vehicleCapacity) &&
        vehicleCapacity > 0;
      return {
        areaId: area.id,
        label: area.label,
        ...(hasVehicleCapacity ? { vehicleCapacity } : {}),
        ...(hasVehicleCapacity
          ? {
              occupancyPercent: getOccupancyPercent(
                vehicleCount,
                vehicleCapacity!
              ),
            }
          : {}),
        type: area.type,
        vehicleCount,
      };
    }
  );
  const vehicleCapacity = config.allowedAreas.every(
    (area) =>
      typeof area.vehicleCapacity === "number" && area.vehicleCapacity > 0
  )
    ? config.allowedAreas.reduce(
        (total, area) => total + (area.vehicleCapacity ?? 0),
        0
      )
    : null;
  return {
    areaCounts,
    cameraId,
    detectionCount: classifiedDetections.length,
    ...(includeDetections ? { detections: classifiedDetections } : {}),
    excludedDetectionCount: excludedDetections.length,
    imageUrl: config.imageUrl,
    includedDetectionCount: includedDetections.length,
    occupancyPercent:
      vehicleCapacity === null
        ? null
        : getOccupancyPercent(includedDetections.length, vehicleCapacity),
    reviewed: config.reviewed,
    vehicleCapacity,
  };
};
