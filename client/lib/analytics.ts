import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import ReactGA from "react-ga4";

export const useRecordPageViews = (): void => {
  const { pathname } = useLocation();
  useEffect(() => {
    ReactGA.set({ page: pathname });
    ReactGA.pageview(pathname);
  }, [pathname]);
};
