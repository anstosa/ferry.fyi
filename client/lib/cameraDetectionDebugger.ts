export const CAMERA_DETECTION_DEBUGGER_PATH =
  "/dev/camera-detection/benchmarks";
export const CAMERA_DETECTION_DEBUGGER_TOKEN_KEY =
  "ferry-fyi-dev-camera-detection-access-token";
const CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_PARAM =
  "authorizeCameraDetectionDebugger";
export const CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_REFRESHED_KEY =
  "ferry-fyi-dev-camera-detection-authorization-refreshed";
export const CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_ATTEMPT_KEY =
  "ferry-fyi-dev-camera-detection-authorization-attempted";

// bounded debugger mode routes
const cameraDetectionDebuggerPaths = {
  benchmarks: CAMERA_DETECTION_DEBUGGER_PATH,
  capture: "/dev/camera-detection/capture",
  editor: "/dev/camera-detection/editor",
} as const;

// debugger authorization contracts
type AccessTokenProvider = () => Promise<string>;
type DebuggerNavigator = (path: string) => void;

// perform a full-page debugger navigation
const navigateToDebugger: DebuggerNavigator = (path) =>
  window.location.assign(path);

// clear persisted debugger authorization
export const clearCameraDetectionDebuggerAuthorization = (): void =>
  sessionStorage.removeItem(CAMERA_DETECTION_DEBUGGER_TOKEN_KEY);

// resolve a bounded authorization return route
export const getCameraDetectionDebuggerAuthorizationReturnPath = (
  search: string
): string | null => {
  const mode = new URLSearchParams(search).get(
    CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_PARAM
  );
  // missing debugger mode guard
  if (!mode) {
    return null;
  }
  const returnPath = Object.entries(cameraDetectionDebuggerPaths).find(
    ([candidate]) => candidate === mode
  )?.[1];
  return returnPath ?? null;
};

// authorize and open the detector
export const openCameraDetectionDebugger = async (
  getAccessToken: AccessTokenProvider,
  navigate: DebuggerNavigator = navigateToDebugger
): Promise<void> => {
  const accessToken = await getAccessToken();
  sessionStorage.setItem(CAMERA_DETECTION_DEBUGGER_TOKEN_KEY, accessToken);
  sessionStorage.removeItem(
    CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_ATTEMPT_KEY
  );
  sessionStorage.removeItem(
    CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_REFRESHED_KEY
  );
  navigate(CAMERA_DETECTION_DEBUGGER_PATH);
};
