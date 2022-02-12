import { AnimatePresence, motion } from "framer-motion";
import { colors } from "~/lib/theme";
import { InstallInstructions } from "./InstallInstructions";
import { isNull } from "shared/lib/identity";
import { Link } from "react-router-dom";
import { Share } from "@capacitor/share";
import AboutIcon from "~/static/images/icons/solid/address-card.svg";
import ChevronLeftIcon from "~/static/images/icons/solid/chevron-left.svg";
import clsx from "clsx";
import FeedbackIcon from "~/static/images/icons/solid/question-circle.svg";
import logo from "~/static/images/icon_monochrome.png";
import React, {
  FunctionComponent,
  ReactElement,
  SVGAttributes,
  useState,
} from "react";
import ReloadIcon from "~/static/images/icons/solid/redo.svg";
import ScheduleIcon from "~/static/images/icons/solid/calendar-alt.svg";
import ShareIcon from "~/static/images/icons/solid/share-square.svg";
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

interface BaseMenuItem {
  Icon: FunctionComponent<SVGAttributes<SVGElement>>;
  label: string;
}

interface InternalLinkMenuItem extends BaseMenuItem {
  path: string;
}

interface ExternalLinkMenuItem extends BaseMenuItem {
  url: string;
}

interface ButtonMenuItem extends BaseMenuItem {
  onClick: () => void;
}

export type MenuItem =
  | InternalLinkMenuItem
  | ExternalLinkMenuItem
  | ButtonMenuItem;

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
    {
      Icon: AboutIcon,
      label: "About",
      path: "/about",
    },
    {
      Icon: FeedbackIcon,
      label: "Feedback",
      path: "/feedback",
    },
    ...(reload
      ? [
          {
            Icon: ReloadIcon,
            label: "Refresh Data",
            onClick: () => {
              reload();
              onClose();
            },
          },
        ]
      : []),
    ...(share && Share.canShare()
      ? [
          {
            Icon: ShareIcon,
            label: shareMenuText,
            onClick: async (): Promise<void> => {
              try {
                await Share.share({
                  title: "Ferry FYI",
                  text: share.sharedText,
                  url: window.location.href,
                  dialogTitle: share.sharedText,
                });
                setShareMenuText("Shared!");
                setTimeout(() => setShareMenuText(share.shareButtonText), 5000);
              } catch (error) {
                console.error("Failed to share", error);
              }
            },
          },
        ]
      : []),
    ...items,
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
            <ChevronLeftIcon
              className="cursor-pointer text-md"
              onClick={onClose}
              aria-label="Close Menu"
            />
          </div>
          <div
            className={clsx(
              "overflow-y-auto scrolling-touch",
              "flex-grow flex flex-col"
            )}
          >
            <ul>
              {navigation.map((item) => {
                const { Icon, label } = item;
                const wrapperClass = clsx(
                  "flex py-4 px-6 hover:bg-lighten-lower"
                );
                const content = (
                  <>
                    {" "}
                    <Icon className="mr-6 text-2xl" />
                    <span className="flex-grow text-xl">{label}</span>
                  </>
                );
                if ("path" in item) {
                  return (
                    <li key={label}>
                      <Link to={item.path} className={wrapperClass}>
                        {content}
                      </Link>
                    </li>
                  );
                } else if ("url" in item) {
                  return (
                    <li key={label}>
                      <a
                        href={item.url}
                        className={wrapperClass}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {content}
                      </a>
                    </li>
                  );
                } else {
                  return (
                    <li key={label}>
                      <div onClick={item.onClick} className={wrapperClass}>
                        {content}
                      </div>
                    </li>
                  );
                }
              })}
            </ul>
            <div className="flex-grow" />
            <div className="p-4">
              <InstallInstructions />
            </div>
          </div>
        </motion.nav>
      </>
    </AnimatePresence>
  );
};
