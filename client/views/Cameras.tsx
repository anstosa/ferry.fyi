import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { DateTime } from "luxon";
import React, {
  CSSProperties,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Camera } from "shared/contracts/cameras";
import type { Terminal } from "shared/contracts/terminals";
import { isNull } from "shared/lib/identity";

import { InlineLoader } from "~/components/InlineLoader";
import { locationToUrl } from "~/lib/maps";
import { useScrollPosition } from "~/lib/scroll";
import CarIcon from "~/static/images/icons/solid/car.svg";
import MapIcon from "~/static/images/icons/solid/map-marker.svg";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";

import { ReloadButton } from "../components/ReloadButton";
import { Header } from "./Header";

interface Props {
  terminal: Terminal | null;
}

interface CameraListProps {
  terminal: Terminal;
}

const CAMERA_REFRESH_MS = 10 * 1000;
const NO_CAMERAS_MESSAGE = "This terminal does not have cameras";

export const Cameras = ({ terminal }: Props): ReactElement => {
  // loading guard
  if (!terminal) {
    return <InlineLoader>Loading cameras...</InlineLoader>;
  }
  return <CameraList terminal={terminal} />;
};

// render loaded terminal
const CameraList = ({ terminal }: CameraListProps): ReactElement => {
  const { cameras } = terminal;
  const hasCameras = cameras.length > 0;
  const [cameraTime, setCameraTime] = useState<number>(
    DateTime.local().toSeconds()
  );
  const [timelineStart, setTimelineStart] = useState<number | null>(null);
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const firstMarker = useRef<HTMLDivElement | null>(null);
  const timeline = useRef<HTMLDivElement | null>(null);
  const wrapper = useRef<HTMLDivElement | null>(null);
  const { y } = useScrollPosition(wrapper);

  // align timeline rail
  const updateTimelineStart = useCallback((): void => {
    const marker = firstMarker.current;
    const container = timeline.current;
    // missing refs guard
    if (!marker || !container) {
      return;
    }
    const markerBox = marker.getBoundingClientRect();
    const containerBox = container.getBoundingClientRect();
    setTimelineStart(markerBox.top - containerBox.top);
  }, []);

  // refresh camera images
  useEffect(() => {
    const interval = window.setInterval(() => {
      setCameraTime(DateTime.local().toSeconds());
    }, CAMERA_REFRESH_MS);
    return () => {
      // remove refresh interval
      window.clearInterval(interval);
    };
  }, []);

  // recalculate rail start
  useEffect(() => {
    updateTimelineStart();
  }, [terminal.id, updateTimelineStart]);

  // recalculate on resize
  useEffect(() => {
    window.addEventListener("resize", updateTimelineStart);
    return () => {
      // remove resize listener
      window.removeEventListener("resize", updateTimelineStart);
    };
  }, [updateTimelineStart]);

  const reload = () => setCameraTime(DateTime.local().toSeconds());

  // track image load
  const markImageLoaded = (imageKey: string): void => {
    setLoadedImages((current) => ({ ...current, [imageKey]: true }));
  };

  // render camera item
  const renderCamera = (camera: Camera, index: number): ReactNode => {
    const { carsToBoat, id, title, image, location, owner } = camera;
    const mapsUrl = locationToUrl(location);
    const imageKey = `${id}-${cameraTime}`;
    const imageLoaded = loadedImages[imageKey] ?? false;
    const isFirst = index === 0;
    const markerRef = isFirst ? firstMarker : undefined;

    return (
      <li className={clsx("flex flex-col", "relative")} key={id}>
        <div
          className={clsx(
            "w-full max-w-[480px] rounded",
            "bg-gray-light dark:bg-gray-dark"
          )}
        >
          <img
            src={`${image.url}?${cameraTime}`}
            className={clsx(
              "block w-full max-w-[480px]",
              imageLoaded ? "h-auto" : "h-[300px] opacity-0",
              owner?.name && "border border-black"
            )}
            alt={`Traffic Camera: ${title}`}
            onLoad={() => {
              markImageLoaded(imageKey);
              // first image alignment
              if (isFirst) {
                updateTimelineStart();
              }
            }}
          />
        </div>
        <span className="relative mt-3 mb-2 flex flex-col gap-1 px-1 text-lg font-bold">
          <div
            ref={markerRef}
            className={clsx(
              "absolute top-0 left-0 -ml-[3.375rem] z-10",
              "flex h-9 w-12 items-center justify-center",
              "bg-white text-black dark:bg-black dark:text-white"
            )}
          >
            <MapIcon className="text-2xl" />
          </div>
          <a
            href={mapsUrl}
            target="_blank"
            className="link"
            rel="noopener noreferrer"
          >
            {title}
          </a>
          {/* cars-to-boat guard */}
          {!isNull(carsToBoat) && (
            <span className={clsx("font-normal text-sm")}>
              <CarIcon className="inline-block mr-2" />
              {carsToBoat} cars to boat
            </span>
          )}
        </span>
      </li>
    );
  };

  return (
    <>
      <Header
        reload={reload}
        share={{
          shareButtonText: "Share Cameras",
          sharedText: `Cameras for ${terminal.name} Ferry Terminal`,
        }}
        items={[
          ...(terminal.terminalUrl
            ? [
                {
                  Icon: WSDOTIcon,
                  label: "WSF Cameras Page",
                  url: terminal.terminalUrl,
                  isBottom: true,
                },
              ]
            : []),
        ]}
      >
        <span className="text-center flex-1">{terminal.name} Cameras</span>
        <ReloadButton
          onClick={() => reload()}
          ariaLabel="Reload Cameras"
          isReloading={false}
        />
      </Header>
      <main
        className="flex-grow overflow-y-scroll scrolling-touch bg-white text-black dark:bg-black dark:text-white"
        ref={wrapper}
      >
        <div
          className={clsx(
            "mx-auto relative max-w-lg",
            hasCameras
              ? "my-6 pl-16 pr-4"
              : "flex min-h-full items-center justify-center p-4 text-center text-gray-dark dark:text-gray-light"
          )}
          ref={timeline}
        >
          {/* camera timeline */}
          {hasCameras && (
            <div
              className={clsx(
                "border-l-4 border-dotted border-black dark:border-white",
                "w-1",
                "absolute bottom-0 left-0 ml-8",
                isNull(timelineStart) && "hidden"
              )}
              style={
                {
                  top: timelineStart ?? 0,
                } as CSSProperties
              }
            />
          )}
          {/* Top shadow on scroll */}
          <AnimatePresence>
            {y > 0 && (
              <motion.div
                className={clsx(
                  "fixed top-16 left-0 w-full h-2",
                  "pointer-events-none z-20",
                  "bg-gradient-to-b from-darken-medium to-transparent"
                )}
                initial={{ opacity: 0.5 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0.5 }}
                transition={{ duration: 0.1 }}
              />
            )}
          </AnimatePresence>
          {/* camera empty state */}
          {hasCameras ? (
            <ul className="flex flex-col gap-8">{cameras.map(renderCamera)}</ul>
          ) : (
            <p>{NO_CAMERAS_MESSAGE}</p>
          )}
        </div>
      </main>
    </>
  );
};
