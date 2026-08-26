import { useAuth0 } from "@auth0/auth0-react";
import React, {
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  type AdCampaignCreative,
  type AdExposure,
  type AdSlotId,
  getAdPlacementKey,
} from "shared/contracts/ads";

import {
  getAdAdminConfigurationPath,
  isNativeAdPlatform,
  issueAdExposure,
  measureAdExposure,
  openNativeAdClick,
  recordWebAdClick,
} from "~/lib/ads";
import { usePublicSsrSource } from "~/lib/ssrSeed";
import { useUser } from "~/lib/user";
import CrownIcon from "~/static/images/icons/solid/crown.svg";

import { AdCreativeCard } from "./AdCreativeCard";

const ADMIN_EMAIL = "anstosa@gmail.com";
const ADMIN_LONG_PRESS_MS = 600;
const ADMIN_LONG_PRESS_MOVEMENT_PX = 10;

interface Props {
  arrivalTerminalId?: string;
  className?: string;
  contextLabel: string;
  departureTerminalId?: string;
  slot: AdSlotId;
}

const useContinuousVisibility = (
  target: React.RefObject<Element | null>,
  threshold: number,
  onVisible: () => void,
  activationKey?: unknown
): void => {
  const callback = useRef(onVisible);
  callback.current = onVisible;
  useEffect(() => {
    const element = target.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let visible = false;
    let claimed = false;
    const cancel = (): void => {
      visible = false;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    const start = (): void => {
      if (claimed || visible || document.visibilityState !== "visible") {
        return;
      }
      visible = true;
      timer = setTimeout(() => {
        if (visible && document.visibilityState === "visible") {
          claimed = true;
          callback.current();
        }
      }, 1_000);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.intersectionRatio >= threshold) {
          start();
        } else {
          cancel();
        }
      },
      { threshold }
    );
    const onVisibilityChange = (): void => {
      if (document.visibilityState !== "visible") {
        cancel();
      }
    };
    observer.observe(element);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancel();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [activationKey, target, threshold]);
};

const sendMeasurement = (
  exposure: AdExposure | null,
  event: "opportunity" | "served" | "viewable",
  accessToken?: string
): void => {
  // active exposure guard
  if (exposure?.token) {
    measureAdExposure(exposure.token, event, accessToken).catch(
      () => undefined
    );
  }
};

const useAdminLongPress = (
  onLongPress: (() => void) | undefined
): {
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
} => {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef({ x: 0, y: 0 });
  const triggered = useRef(false);
  const cancel = (): void => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
  };

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    []
  );

  return {
    onClickCapture: (event) => {
      if (!triggered.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      triggered.current = false;
    },
    onContextMenu: (event) => {
      if (onLongPress) {
        event.preventDefault();
      }
    },
    onPointerCancel: cancel,
    onPointerDown: (event) => {
      if (!onLongPress || event.button !== 0 || event.isPrimary === false) {
        return;
      }
      cancel();
      triggered.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = undefined;
        triggered.current = true;
        onLongPress();
      }, ADMIN_LONG_PRESS_MS);
    },
    onPointerMove: (event) => {
      if (
        Math.abs(event.clientX - origin.current.x) >
          ADMIN_LONG_PRESS_MOVEMENT_PX ||
        Math.abs(event.clientY - origin.current.y) >
          ADMIN_LONG_PRESS_MOVEMENT_PX
      ) {
        cancel();
      }
    },
    onPointerUp: cancel,
  };
};

const AdCard = ({
  creative,
  exposure,
  accessToken,
  onAdminLongPress,
}: {
  creative: AdCampaignCreative;
  exposure: AdExposure | null;
  accessToken?: string;
  onAdminLongPress?: () => void;
}): ReactElement => {
  const cardRef = useRef<HTMLAnchorElement>(null);
  const longPressHandlers = useAdminLongPress(onAdminLongPress);
  useContinuousVisibility(cardRef, 0.5, () =>
    sendMeasurement(exposure, "viewable", accessToken)
  );
  useEffect(() => {
    sendMeasurement(exposure, "served", accessToken);
  }, [accessToken, exposure]);
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (!exposure?.token) {
      return;
    }
    if (isNativeAdPlatform()) {
      event.preventDefault();
      openNativeAdClick({
        accessToken,
        campaignId: creative.campaignId,
        fallbackTargetUrl: creative.targetUrl,
        token: exposure.token,
      }).catch(() => undefined);
      return;
    }
    recordWebAdClick({
      accessToken,
      campaignId: creative.campaignId,
      token: exposure.token,
    }).catch(() => undefined);
  };
  return (
    <AdCreativeCard
      adminConfigurable={Boolean(onAdminLongPress)}
      creative={creative}
      onClick={onClick}
      ref={cardRef}
      {...longPressHandlers}
    />
  );
};

const AdPlaceholder = ({
  contextLabel,
  loading,
  onConfigure,
}: {
  contextLabel: string;
  loading: boolean;
  onConfigure: () => void;
}): ReactElement => (
  <aside aria-label={`Advertisement placeholder for ${contextLabel}`}>
    <button
      aria-label={`Configure ad for ${contextLabel}`}
      className="block w-full rounded-xl border-2 border-dotted border-sponsor-light bg-transparent p-3 text-left text-gray-darkest shadow-sm transition hover:border-sponsor-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sponsor-dark dark:border-sponsor-dark dark:bg-transparent dark:text-white dark:hover:border-sponsor-light dark:focus-visible:outline-sponsor-light"
      data-ad-placeholder="true"
      onClick={onConfigure}
      type="button"
    >
      <span className="block text-2xs font-bold uppercase tracking-[0.14em] text-sponsor-dark dark:text-sponsor-light">
        Ad slot placeholder
      </span>
      <span className="mt-0.5 block text-base font-black leading-tight">
        {contextLabel}
      </span>
      <span className="mt-0.5 block text-xs leading-snug">
        {loading
          ? "Checking ad campaign…"
          : "No active ad is configured for this placement."}
      </span>
    </button>
    <p className="mt-1 text-right text-2xs font-semibold text-sponsor-dark dark:text-sponsor-light">
      Advertisement
    </p>
  </aside>
);

/** Replaces the homepage advertisement with an active Supporter thank-you. */
const SupporterThankYou = (): ReactElement => {
  const [isOpen, setIsOpen] = useState(false);
  // toggle supporter message
  const toggleMessage = (): void => setIsOpen((current) => !current);
  return (
    <div className="absolute right-2 top-2 z-20 mt-safe-top">
      <button
        aria-controls="homepage-supporter-thank-you-panel"
        aria-expanded={isOpen}
        aria-label={`${isOpen ? "Hide" : "Show"} Supporter thank-you`}
        className="group relative isolate flex h-10 w-10 items-center justify-center rounded-xl border border-[#ffec9f] bg-[linear-gradient(135deg,#fff6bb_0%,#f8d65a_28%,#d99a0a_58%,#ffe681_82%,#be7800_100%)] text-[#4b3100] shadow-[0_4px_16px_rgba(242,183,5,0.55)] transition hover:scale-105 hover:shadow-[0_6px_22px_rgba(242,183,5,0.7)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        onClick={toggleMessage}
        type="button"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-1 top-1 h-1/2 rounded-full bg-gradient-to-b from-white/80 to-transparent"
        />
        <CrownIcon aria-hidden className="relative h-6 w-6" />
        <span
          aria-hidden
          className="supporter-crown-sparkle pointer-events-none absolute -right-1 -top-1 text-sm text-yellow-lightest"
        >
          ✦
        </span>
        <span
          aria-hidden
          className="supporter-crown-sparkle supporter-crown-sparkle--delayed pointer-events-none absolute -bottom-1 -left-1 text-xs text-yellow-lightest"
        >
          ✦
        </span>
      </button>
      {/* open supporter message */}
      {isOpen && (
        <aside
          aria-labelledby="homepage-supporter-thank-you-title"
          className="supporter-thank-you-drop fixed left-2 right-2 top-[calc(var(--safe-area-inset-top)+3.5rem)] overflow-hidden rounded-2xl border border-[#b97804] bg-[linear-gradient(135deg,#fff6bb_0%,#f8d65a_26%,#d99a0a_52%,#ffe681_76%,#be7800_100%)] p-4 text-[#3d2800] shadow-[0_12px_30px_rgba(0,0,0,0.28)] sm:left-auto sm:w-96"
          id="homepage-supporter-thank-you-panel"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-br from-white/65 to-transparent"
          />
          <div className="relative">
            <h2
              className="text-base font-black"
              id="homepage-supporter-thank-you-title"
            >
              Thank you for supporting Ferry FYI
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-[#614000]">
              Your subscription helps keep schedules, alerts, forecasts,
              cameras, and ticket tools available for every ferry rider. Enjoy
              your ad-free experience.
            </p>
          </div>
        </aside>
      )}
    </div>
  );
};

/** Renders a contextual campaign and measures its anonymous opportunity. */
export const AdSlot = ({
  arrivalTerminalId,
  className = "",
  contextLabel,
  departureTerminalId,
  slot,
}: Props): ReactElement | null => {
  const {
    getAccessTokenSilently,
    isAuthenticated,
    isLoading: isAuthLoading,
    user: auth0User,
  } = useAuth0();
  const [{ isUserLoading, user: accountUser }] = useUser();
  const navigate = useNavigate();
  const ssrAd = usePublicSsrSource("ad");
  const [exposure, setExposure] = useState<AdExposure | null>(null);
  const [exposureResolved, setExposureResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | undefined>();
  const opportunityRef = useRef<HTMLSpanElement>(null);
  const isAdmin =
    isAuthenticated &&
    auth0User?.email?.toLocaleLowerCase("en-US") === ADMIN_EMAIL;
  const supporter = accountUser?.supporter;
  const policyResolved =
    !isAuthLoading &&
    (!isAuthenticated || (!isUserLoading && supporter?.resolved === true));
  const clientSuppressAds =
    policyResolved &&
    supporter?.active === true &&
    supporter.adsEnabled !== true;
  const exposureRequestBlocked = isAuthLoading || clientSuppressAds;
  const showSupporterThankYou =
    policyResolved &&
    isAuthenticated &&
    supporter?.active === true &&
    supporter.adsEnabled !== true &&
    slot === "home";
  const hasDirection = Boolean(arrivalTerminalId && departureTerminalId);
  const key =
    slot === "home" || hasDirection
      ? getAdPlacementKey({
          arrivalTerminalId: arrivalTerminalId ?? null,
          departureTerminalId: departureTerminalId ?? null,
          slot,
        })
      : null;
  const hasSsrAd = Boolean(
    key && !isAuthenticated && policyResolved && ssrAd?.placementKey === key
  );

  useEffect(() => {
    let active = true;
    setExposure(null);
    setExposureResolved(false);
    setAccessToken(undefined);
    setLoading(Boolean(key) && !hasSsrAd);
    // invalid or locally suppressed guard
    if (!key || exposureRequestBlocked) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    const getPolicyToken = async (): Promise<string | undefined> => {
      // anonymous ad guard
      if (!isAuthenticated) {
        return undefined;
      }
      return await getAccessTokenSilently();
    };
    getPolicyToken()
      .then(async (token) => {
        // stale token guard
        if (!active) {
          return null;
        }
        setAccessToken(token);
        return await issueAdExposure(key, token);
      })
      .then((value) => {
        // stale exposure guard
        if (active && value) {
          setExposure(value);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setExposureResolved(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [
    auth0User?.sub,
    exposureRequestBlocked,
    getAccessTokenSilently,
    hasSsrAd,
    isAuthenticated,
    key,
    ssrAd?.creative?.campaignId,
  ]);

  useContinuousVisibility(
    opportunityRef,
    1,
    () => sendMeasurement(exposure, "opportunity", accessToken),
    `${exposure?.token ?? ""}:${supporter?.revision ?? "anonymous"}`
  );

  // replace only the resolved homepage placement
  if (showSupporterThankYou) {
    return <SupporterThankYou />;
  }
  // hidden policy guard
  if (!key || clientSuppressAds) {
    return null;
  }
  let creative = exposure?.creative ?? null;
  if (!exposureResolved && hasSsrAd) {
    creative = ssrAd?.creative ?? null;
  }
  const configure = (): void => {
    navigate(getAdAdminConfigurationPath(key));
  };
  let content: ReactElement | null = null;
  if (creative) {
    content = (
      <AdCard
        accessToken={accessToken}
        creative={creative}
        exposure={exposure}
        onAdminLongPress={isAdmin ? configure : undefined}
      />
    );
  } else if (isAdmin) {
    content = (
      <AdPlaceholder
        contextLabel={contextLabel}
        loading={loading}
        onConfigure={configure}
      />
    );
  }
  return (
    <div
      className={content ? `relative ${className}` : "relative h-0"}
      data-ad-slot={slot}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
        data-ad-opportunity-anchor="true"
        ref={opportunityRef}
      />
      {content}
    </div>
  );
};
