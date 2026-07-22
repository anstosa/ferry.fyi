import { useAuth0 } from "@auth0/auth0-react";
import { Browser } from "@capacitor/browser";
import { Share } from "@capacitor/share";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import React, { ReactElement, SVGAttributes, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { isNull } from "shared/lib/identity";

import {
  getBrowserInstallPlatform,
  requestInstallPrompt,
} from "~/lib/appInstall";
import { getConfiguredAuth0RedirectUri } from "~/lib/auth";
import { isInstalledApp, useDevice } from "~/lib/device";
import { colors } from "~/lib/theme";
import logo from "~/static/images/icon_monochrome-256.png";
import AppStoreIcon from "~/static/images/icons/brands/app-store-ios.svg";
import GooglePlayIcon from "~/static/images/icons/brands/google-play.svg";
import AboutIcon from "~/static/images/icons/solid/address-card.svg";
import TicketIcon from "~/static/images/icons/solid/barcode-alt.svg";
import ScheduleIcon from "~/static/images/icons/solid/calendar-week.svg";
import DownloadIcon from "~/static/images/icons/solid/download.svg";
import FeedbackIcon from "~/static/images/icons/solid/question-circle.svg";
import ShareIcon from "~/static/images/icons/solid/share-alt.svg";
import UserIcon from "~/static/images/icons/solid/user.svg";

import { MenuItem } from "./MenuItem";

export interface ShareOptions {
  sharedText: string;
  shareButtonText: string;
}

interface Props {
  hasTopBanner: boolean;
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
  share?: ShareOptions;
  items?: MenuItem[];
}

// menu avatar
const Avatar = ({ className }: SVGAttributes<SVGElement>) => {
  const { user } = useAuth0();
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  // image failure fallback
  const handleImageError = () => setFailedImageUrl(user?.picture ?? null);

  // profile image guard
  if (user?.picture && failedImageUrl !== user.picture) {
    return (
      <img
        alt=""
        src={user.picture}
        className={clsx(
          className,
          "h-6 w-6 rounded object-cover overflow-hidden"
        )}
        onError={handleImageError}
      />
    );
  }
  return <UserIcon className={className} />;
};

export const Menu = ({
  hasTopBanner,
  isOpen,
  onClose,
  onOpen,
  share,
  items = [],
}: Props): ReactElement | null => {
  const [shareMenuText, setShareMenuText] = useState<string>(
    share?.shareButtonText ?? "Share"
  );
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const device = useDevice();
  const { isAuthenticated, loginWithRedirect } = useAuth0();
  const [canShare, setShare] = useState<boolean>(false);
  const location = useLocation();

  const initShare = async () => {
    const { value: canShare } = await Share.canShare();
    setShare(canShare);
  };

  // login route
  const login = async () => {
    // native browser login
    if (device?.isNativeMobile) {
      await loginWithRedirect({
        appState: { redirectPath: location.pathname },
        authorizationParams: {
          redirect_uri: getConfiguredAuth0RedirectUri(),
        },
        openUrl: async (url) => {
          await Browser.open({ url });
        },
      });
    } else {
      loginWithRedirect({
        appState: { redirectPath: location.pathname },
        authorizationParams: {
          redirect_uri: getConfiguredAuth0RedirectUri(),
        },
      });
    }
  };

  useEffect(() => {
    initShare();
  }, []);

  const topItems = items.filter(
    (item) => !("isBottom" in item) || !item.isBottom
  );
  const bottomItems = items.filter(
    (item) => "isBottom" in item && item.isBottom
  );

  const accountItem: MenuItem = isAuthenticated
    ? {
        Icon: Avatar,
        label: "Account",
        path: "/account",
      }
    : {
        Icon: UserIcon,
        label: "Log In",
        onClick: login,
      };
  const platform = getBrowserInstallPlatform();
  let InstallIcon = DownloadIcon;
  if (platform === "android") {
    InstallIcon = GooglePlayIcon;
  } else if (platform === "ios") {
    InstallIcon = AppStoreIcon;
  }
  const installItem: MenuItem | null = isInstalledApp()
    ? null
    : {
        Icon: InstallIcon,
        label: "Install Ferry FYI",
        onClick: () => {
          onClose();
          requestInstallPrompt();
        },
      };
  const navigation: MenuItem[] = [
    {
      Icon: ScheduleIcon,
      label: "Schedule",
      path: "/",
    },
    {
      Icon: TicketIcon,
      label: "Tickets",
      path: "/tickets",
    },
    ...topItems,
    { isSpacer: true },
    ...(installItem ? [installItem] : []),
    accountItem,
    ...bottomItems,
    {
      Icon: AboutIcon,
      label: "About",
      path: "/about",
      isBottom: true,
    },
    {
      Icon: FeedbackIcon,
      label: "Feedback",
      path: "/feedback",
      isBottom: true,
    },
  ];
  return (
    <AnimatePresence>
      <>
        {!isOpen && (
          <motion.div
            drag="x"
            dragElastic={0}
            dragMomentum={false}
            onDragStart={({ pageX }: MouseEvent) => {
              setDragStart(pageX);
              setDragPosition(pageX);
            }}
            onDrag={({ pageX }: MouseEvent) => {
              setDragPosition(pageX);
            }}
            onDragEnd={() => {
              if ((dragPosition ?? 0) > (dragStart ?? 0)) {
                onOpen();
              }
              setDragStart(null);
            }}
            dragConstraints={{
              top: 0,
              left: 0,
              right: 250,
              bottom: 0,
            }}
            className="h-screen w-2 fixed inset-y-0 left-0 z-30"
          />
        )}
        {isOpen && (
          <motion.div
            className={clsx(
              "fixed inset-0",
              isOpen ? "z-30" : "z-bottom pointer-events-none"
            )}
            initial={{ backdropFilter: "blur(0)", background: "transparent" }}
            animate={{
              backdropFilter: "blur(5px)",
              backgroundColor: colors.darken.low,
            }}
            exit={{ backdropFilter: "blur(0)", background: "transparent" }}
            transition={{ ease: "linear", type: "tween" }}
            onClick={onClose}
          />
        )}
        <motion.nav
          drag="x"
          dragElastic={0}
          dragMomentum={false}
          onDragStart={({ pageX, currentTarget }: MouseEvent) => {
            setDragStart(pageX);
            setDragPosition((currentTarget as HTMLElement)?.offsetLeft);
          }}
          onDrag={({ currentTarget }: MouseEvent) => {
            setDragPosition((currentTarget as HTMLElement)?.offsetLeft);
          }}
          onDragEnd={() => {
            if ((dragPosition ?? 0) < (dragStart ?? 0)) {
              onClose();
            }
            setDragStart(null);
            setDragPosition(null);
          }}
          initial={
            isOpen ? { left: `calc(-100% + ${dragPosition ?? 0}px)` } : {}
          }
          animate={
            // eslint-disable-next-line no-nested-ternary
            isNull(dragStart) ? (isOpen ? { left: 0 } : { left: "-100%" }) : {}
          }
          transition={{ ease: "easeOut", type: "tween" }}
          className={clsx(
            "animate",
            "flex flex-col",
            "bg-ferry-gradient text-white shadow-lg",
            "w-full max-w-xs",
            hasTopBanner ? "h-[calc(100vh-80px)]" : "h-screen",
            "fixed top-0 z-30 -left-full",
            "pt-safe-top pl-safe-left",
            // Keep the bottom menu links above the mobile tab bar and the
            // device safe area. Desktop menus retain their existing inset.
            "pb-[calc(4rem+var(--safe-area-inset-bottom))] sm:pb-safe-bottom"
          )}
          style={{
            // align with the banner-adjusted page header
            top: hasTopBanner ? "80px" : 0,
            ...(isNull(dragStart)
              ? {}
              : { left: `calc(-100% + ${dragPosition ?? 0}px)` }),
          }}
          aria-label="Main navigation"
        >
          <div
            className={clsx(
              "h-16 w-full p-4",
              "text-2xl",
              "flex items-center",
              "border-b border-[rgba(255,255,255,0.12)]"
            )}
          >
            <Link to="/" className="flex items-center">
              <img
                alt="Ferry FYI"
                className="inline-block mr-4 w-10"
                height={40}
                src={logo}
                width={40}
              />
              <h1 className="font-bold">Ferry FYI</h1>
            </Link>
            <div className="flex-grow" />
            {share && canShare && (
              <div
                className="w-10 h-10 cursor-pointer text-md flex justify-center items-center"
                onClick={async (): Promise<void> => {
                  try {
                    await Share.share({
                      title: "Ferry FYI",
                      text: share.sharedText,
                      url: `${process.env.BASE_URL}${location.pathname}${location.search}`,
                      dialogTitle: share.sharedText,
                    });
                    setShareMenuText("Shared!");
                    setTimeout(
                      () => setShareMenuText(share.shareButtonText),
                      5000
                    );
                  } catch (error) {
                    console.error("Failed to share", error);
                  }
                }}
                aria-label={shareMenuText}
              >
                <ShareIcon />
              </div>
            )}
          </div>
          <div
            className={clsx(
              "overflow-y-auto scrolling-touch",
              "flex-grow flex flex-col"
            )}
          >
            <ul className="flex flex-col items-start flex-grow">
              {navigation.map((item, index) => (
                <MenuItem item={item} key={index} />
              ))}
            </ul>
          </div>
        </motion.nav>
      </>
    </AnimatePresence>
  );
};
