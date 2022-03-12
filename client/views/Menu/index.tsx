import { AnimatePresence, motion } from "framer-motion";
import { colors } from "~/lib/theme";
import { isNull } from "shared/lib/identity";
import { Link, useLocation } from "react-router-dom";
import { Share } from "@capacitor/share";
import { useDevice } from "~/lib/device";
import AboutIcon from "~/static/images/icons/solid/address-card.svg";
import UserIcon from "~/static/images/icons/solid/user.svg";
// import AppleIcon from "~/static/images/icons/brands/apple.svg";
import { Browser } from "@capacitor/browser";
import { MenuItem } from "./MenuItem";
import { useAuth0 } from "@auth0/auth0-react";
import clsx from "clsx";
import FeedbackIcon from "~/static/images/icons/solid/question-circle.svg";
import GooglePlayIcon from "~/static/images/icons/brands/google-play.svg";
import logo from "~/static/images/icon_monochrome.png";
import React, { ReactElement, useEffect, useState } from "react";
import ReloadIcon from "~/static/images/icons/solid/redo.svg";
import ScheduleIcon from "~/static/images/icons/solid/calendar-alt.svg";
import ShareIcon from "~/static/images/icons/solid/share-alt.svg";
import TicketIcon from "~/static/images/icons/solid/barcode-alt.svg";

export interface ShareOptions {
  sharedText: string;
  shareButtonText: string;
}

interface Props {
  isOpen: boolean;
  reload?: () => void;
  onClose: () => void;
  onOpen: () => void;
  share?: ShareOptions;
  items?: MenuItem[];
}

const Avatar = () => {
  const { user } = useAuth0();
  if (user?.picture) {
    return (
      <img src={user?.picture} className="rounded w-6 mr-6 overflow-hidden" />
    );
  } else {
    return <UserIcon />;
  }
};

export const Menu = ({
  isOpen,
  onClose,
  onOpen,
  reload,
  share,
  items = [],
}: Props): ReactElement | null => {
  const [shareMenuText, setShareMenuText] = useState<string>(
    share?.shareButtonText ?? "Share"
  );
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const device = useDevice();
  const { isAuthenticated, loginWithRedirect, buildAuthorizeUrl } = useAuth0();
  const [canShare, setShare] = useState<boolean>(false);
  const location = useLocation();

  const initShare = async () => {
    const { value: canShare } = await Share.canShare();
    setShare(canShare);
  };

  const login = async () => {
    if (device?.isNativeMobile) {
      const url = await buildAuthorizeUrl({
        appState: { redirectPath: location.pathname },
        redirect_uri: process.env.AUTH0_CLIENT_REDIRECT,
      });
      await Browser.open({ url });
    } else {
      loginWithRedirect({
        appState: { redirectPath: location.pathname },
        redirectUri: process.env.AUTH0_CLIENT_REDIRECT,
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

  const navigation: MenuItem[] = [
    ...(isAuthenticated
      ? [
          {
            Icon: Avatar,
            label: "Account",
            path: "/account",
          },
        ]
      : [
          {
            Icon: UserIcon,
            label: "Log In",
            onClick: login,
          },
        ]),
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
              console.log(pageX);
              setDragStart(pageX);
              setDragPosition(pageX);
            }}
            onDrag={({ pageX }: MouseEvent) => {
              console.log(pageX);
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
            transition={{ type: "linear" }}
            onClick={onClose}
          />
        )}
        <motion.nav
          drag="x"
          dragElastic={0}
          dragMomentum={false}
          onDragStart={({ pageX, currentTarget }: MouseEvent) => {
            console.log(pageX, currentTarget);
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
          transition={{ type: "easeOut" }}
          className={clsx(
            "animate",
            "flex flex-col",
            "bg-green-dark text-white shadow-lg",
            "w-full h-screen max-w-xs",
            "fixed top-0 z-30 -left-full",
            "pt-safe-top pb-safe-bottom pl-safe-left"
          )}
          style={
            isNull(dragStart)
              ? {}
              : {
                  left: `calc(-100% + ${dragPosition ?? 0}px)`,
                }
          }
        >
          <div
            className={clsx("h-16 w-full p-4", "text-2xl", "flex items-center")}
          >
            <Link to="/" className="flex items-center">
              <img src={logo} className="inline-block mr-4 w-10" />
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
            {reload && (
              <div
                className="w-10 h-10 cursor-pointer text-md flex justify-center items-center"
                onClick={() => {
                  reload();
                  onClose();
                }}
                aria-label="Refresh"
              >
                <ReloadIcon />
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
            <div className="p-4">
              {/* {device?.platform === "web" && device?.operatingSystem === "ios" && (
                <a
                  href="https://play.google.com/store/apps/details?id=fyi.ferry"
                  className="button button-invert flex-grow"
                >
                  <AppleIcon className="inline-block button-icon text-2xl" />
                  <span className="button-label">Install on the App Store</span>
                </a>
              )} */}
              {device?.platform === "web" &&
                device?.operatingSystem === "android" && (
                  <a
                    href="https://play.google.com/store/apps/details?id=fyi.ferry"
                    className="button button-invert flex-grow"
                  >
                    <GooglePlayIcon className="inline-block button-icon text-2xl" />
                    <span className="button-label">
                      Install on the Play Store
                    </span>
                  </a>
                )}
            </div>
          </div>
        </motion.nav>
      </>
    </AnimatePresence>
  );
};
