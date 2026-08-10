import type {
  CameraAreaOccupancy,
  CameraAreaOccupancyState,
  CameraDetectionArea,
  CameraDetectionCameraConfig,
  CameraDetectionPoint,
  CameraLineDetectionResult,
  CameraLineVehicleDetection,
  VehicleDetection,
  VehicleDetectionBox,
} from "shared/contracts/cameraDetection";

const VEHICLE_LABELS = new Set(["bus", "car", "motorcycle", "truck", "van"]);
const MAJORITY_OCCUPANCY_THRESHOLD = 0.5;
const FULL_OCCUPANCY_THRESHOLD = 0.85;

// bound a value
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

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

// derive polygon principal axis
const getPolygonAxis = (
  polygon: CameraDetectionPoint[]
): CameraDetectionPoint => {
  const center = polygon.reduce<CameraDetectionPoint>(
    (total, point) => [total[0] + point[0], total[1] + point[1]],
    [0, 0]
  );
  center[0] /= polygon.length;
  center[1] /= polygon.length;
  const covariance = polygon.reduce(
    (total, point) => {
      const x = point[0] - center[0];
      const y = point[1] - center[1];
      return {
        xx: total.xx + x * x,
        xy: total.xy + x * y,
        yy: total.yy + y * y,
      };
    },
    { xx: 0, xy: 0, yy: 0 }
  );
  const angle =
    Math.atan2(2 * covariance.xy, covariance.xx - covariance.yy) / 2;
  return [Math.cos(angle), Math.sin(angle)];
};

// project one point onto an axis
const projectPoint = (
  point: CameraDetectionPoint,
  axis: CameraDetectionPoint
): number => point[0] * axis[0] + point[1] * axis[1];

// project a detection box onto an axis
const projectDetectionBox = (
  box: VehicleDetectionBox,
  axis: CameraDetectionPoint
): [number, number] => {
  const projections = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x + box.width, box.y + box.height],
    [box.x, box.y + box.height],
  ].map((point) => projectPoint(point as CameraDetectionPoint, axis));
  return [Math.min(...projections), Math.max(...projections)];
};

// merge projected vehicle intervals
const getCoveredLength = (intervals: [number, number][]): number => {
  const sortedIntervals = [...intervals].sort(
    (left, right) => left[0] - right[0]
  );
  let coveredLength = 0;
  let currentInterval: [number, number] | null = null;
  // interval merge pass
  for (const interval of sortedIntervals) {
    // first interval guard
    if (!currentInterval) {
      currentInterval = [...interval];
      continue;
    }
    // overlapping interval guard
    if (interval[0] <= currentInterval[1]) {
      currentInterval[1] = Math.max(currentInterval[1], interval[1]);
      continue;
    }
    coveredLength += currentInterval[1] - currentInterval[0];
    currentInterval = [...interval];
  }
  // final interval guard
  if (currentInterval) {
    coveredLength += currentInterval[1] - currentInterval[0];
  }
  return coveredLength;
};

// measure longitudinal polygon occupancy
export const getAreaSpatialOccupancy = (
  area: CameraDetectionArea,
  detections: VehicleDetection[]
): number => {
  // empty signal guard
  if (detections.length === 0) {
    return 0;
  }
  const axis = getPolygonAxis(area.polygon);
  const polygonProjections = area.polygon.map((point) =>
    projectPoint(point, axis)
  );
  const polygonStart = Math.min(...polygonProjections);
  const polygonEnd = Math.max(...polygonProjections);
  const polygonLength = polygonEnd - polygonStart;
  // degenerate polygon guard
  if (polygonLength <= Number.EPSILON) {
    return 0;
  }
  const intervals = detections
    .map((detection) => projectDetectionBox(detection.box, axis))
    .map(([start, end]): [number, number] => [
      clamp(start, polygonStart, polygonEnd),
      clamp(end, polygonStart, polygonEnd),
    ])
    .filter(([start, end]) => end > start);
  return clamp(getCoveredLength(intervals) / polygonLength, 0, 1);
};

// bucket spatial occupancy
export const getCameraAreaOccupancyState = (
  spatialOccupancy: number
): CameraAreaOccupancyState => {
  // empty state guard
  if (spatialOccupancy <= 0) {
    return "empty";
  }
  // minority state guard
  if (spatialOccupancy < MAJORITY_OCCUPANCY_THRESHOLD) {
    return "minority_full";
  }
  // majority state guard
  if (spatialOccupancy < FULL_OCCUPANCY_THRESHOLD) {
    return "majority_full";
  }
  return "full";
};

// evaluate occupancy by configured areas
export const evaluateCameraOccupancy = (
  cameraId: string,
  config: CameraDetectionCameraConfig,
  detections: VehicleDetection[],
  includeDetections = false
): CameraLineDetectionResult => {
  const classifiedDetections = classifyCameraDetections(config, detections);
  const includedDetections = classifiedDetections.filter((detection) => {
    return detection.disposition === "included";
  });
  const areaStates: CameraAreaOccupancy[] = config.allowedAreas.map((area) => {
    const areaDetections = includedDetections.filter((detection) =>
      detection.allowedAreaIds.includes(area.id)
    );
    return {
      areaId: area.id,
      label: area.label,
      state: getCameraAreaOccupancyState(
        getAreaSpatialOccupancy(area, areaDetections)
      ),
      type: area.type,
    };
  });
  return {
    areaStates,
    cameraId,
    ...(includeDetections ? { detections: classifiedDetections } : {}),
    imageUrl: config.imageUrl,
    reviewed: config.reviewed,
  };
};
