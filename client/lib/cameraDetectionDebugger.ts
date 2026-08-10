export const CAMERA_DETECTION_DEBUGGER_PATH = "/dev/camera-detection";
export const CAMERA_DETECTION_DEBUGGER_TOKEN_KEY =
  "ferry-fyi-dev-camera-detection-access-token";

type AccessTokenProvider = () => Promise<string>;
type DebuggerNavigator = (path: string) => void;

// perform a full-page debugger navigation
const navigateToDebugger: DebuggerNavigator = (path) =>
  window.location.assign(path);

// authorize and open the detector
export const openCameraDetectionDebugger = async (
  getAccessToken: AccessTokenProvider,
  navigate: DebuggerNavigator = navigateToDebugger
): Promise<void> => {
  const accessToken = await getAccessToken();
  sessionStorage.setItem(CAMERA_DETECTION_DEBUGGER_TOKEN_KEY, accessToken);
  navigate(CAMERA_DETECTION_DEBUGGER_PATH);
};
