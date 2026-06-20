import { useEffect } from "react";
import ReactGA from "react-ga4";
import { useLocation } from "react-router-dom";

export const useRecordPageViews = (): void => {
  const { pathname } = useLocation();
  // route tracking
  useEffect(() => {
    ReactGA.set({ page: pathname });
    ReactGA.send({ hitType: "pageview", page: pathname });
  }, [pathname]);
};
