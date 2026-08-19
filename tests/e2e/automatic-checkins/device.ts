// force the dedicated fixture through native-only production ui
export const isNativeMobileApp = (): boolean => {
  // expose one web-only banner scenario
  return (
    new URLSearchParams(window.location.search).get("scenario") !== "web-banner"
  );
};
