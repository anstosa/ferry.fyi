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
  event: "opportunity" | "served" | "viewable"
): void => {
  if (exposure?.token) {
    measureAdExposure(exposure.token, event).catch(() => undefined);
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
  onAdminLongPress,
}: {
  creative: AdCampaignCreative;
  exposure: AdExposure | null;
  onAdminLongPress?: () => void;
}): ReactElement => {
  const cardRef = useRef<HTMLAnchorElement>(null);
  const longPressHandlers = useAdminLongPress(onAdminLongPress);
  useContinuousVisibility(cardRef, 0.5, () =>
    sendMeasurement(exposure, "viewable")
  );
  useEffect(() => {
    sendMeasurement(exposure, "served");
  }, [exposure]);
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (!exposure?.token) {
      return;
    }
    if (isNativeAdPlatform()) {
      event.preventDefault();
      openNativeAdClick({
        campaignId: creative.campaignId,
        fallbackTargetUrl: creative.targetUrl,
        token: exposure.token,
      }).catch(() => undefined);
      return;
    }
    recordWebAdClick({
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

/** Renders a contextual campaign and measures its anonymous opportunity. */
export const AdSlot = ({
  arrivalTerminalId,
  className = "",
  contextLabel,
  departureTerminalId,
  slot,
}: Props): ReactElement | null => {
  const { isAuthenticated, user } = useAuth0();
  const navigate = useNavigate();
  const ssrAd = usePublicSsrSource("ad");
  const [exposure, setExposure] = useState<AdExposure | null>(null);
  const [loading, setLoading] = useState(true);
  const opportunityRef = useRef<HTMLSpanElement>(null);
  const isAdmin =
    isAuthenticated && user?.email?.toLocaleLowerCase("en-US") === ADMIN_EMAIL;
  const hasDirection = Boolean(arrivalTerminalId && departureTerminalId);
  const key =
    slot === "home" || hasDirection
      ? getAdPlacementKey({
          arrivalTerminalId: arrivalTerminalId ?? null,
          departureTerminalId: departureTerminalId ?? null,
          slot,
        })
      : null;
  const hasSsrAd = Boolean(key && ssrAd?.placementKey === key);

  useEffect(() => {
    let active = true;
    setExposure(null);
    setLoading(Boolean(key) && !hasSsrAd);
    if (!key) {
      return () => {
        active = false;
      };
    }
    issueAdExposure(key)
      .then((value) => {
        const ssrCampaignId = ssrAd?.creative?.campaignId ?? null;
        const exposureCampaignId = value.creative?.campaignId ?? null;
        if (active && (!hasSsrAd || ssrCampaignId === exposureCampaignId)) {
          setExposure(value);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [hasSsrAd, key, ssrAd?.creative?.campaignId]);

  useContinuousVisibility(
    opportunityRef,
    1,
    () => sendMeasurement(exposure, "opportunity"),
    exposure?.token
  );

  if (!key) {
    return null;
  }
  const creative = hasSsrAd ? (ssrAd?.creative ?? null) : exposure?.creative;
  const configure = (): void => {
    navigate(getAdAdminConfigurationPath(key));
  };
  let content: ReactElement | null = null;
  if (creative) {
    content = (
      <AdCard
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
