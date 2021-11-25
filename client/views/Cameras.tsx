import { AnimatePresence, motion } from "framer-motion";
import { DateTime } from "luxon";
import { Header } from "./Header";
import { InlineLoader } from "~/components/InlineLoader";
import { isNil, isNull } from "shared/lib/identity";
import { locationToUrl } from "~/lib/maps";
import { ReloadButton } from "../components/ReloadButton";
import { useScrollPosition } from "~/lib/scroll";
import CarIcon from "~/images/icons/solid/car.svg";
import clsx from "clsx";
import MapIcon from "~/images/icons/solid/map-marker.svg";
import ParkingIcon from "~/images/icons/solid/parking.svg";
import React, {
  ReactElement,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Camera } from "shared/contracts/cameras";
import type { Terminal } from "shared/contracts/terminals";

interface Props {
  terminal: Terminal | null;
}

export const Cameras = ({ terminal }: Props): ReactElement => {
  if (!terminal) {
    return <InlineLoader>Loading cameras...</InlineLoader>;
  }
  const { cameras } = terminal;
  const [cameraTime, setCameraTime] = useState<number>(
    DateTime.local().toSeconds()
  );
  const [cameraInterval, setCameraInterval] = useState<number | null>(null);
  const wrapper = useRef<HTMLDivElement | null>(null);
  const { y } = useScrollPosition(wrapper);

  // Update images ever 10 seconds
  useEffect(() => {
    setCameraInterval(
      window.setInterval(() => {
        setCameraTime(DateTime.local().toSeconds());
      }, 10 * 1000)
    );
    return () => {
      if (cameraInterval) {
        clearInterval(cameraInterval);
      }
    };
  }, []);

  const reload = () => setCameraTime(DateTime.local().toSeconds());

  const renderCamera = (camera: Camera, index: number): ReactNode => {
    const { id, title, image, spacesToNext, location, owner } = camera;
    const isFirst = index === 0;
    let totalToBooth: number | null;
    const mapsUrl = locationToUrl(location);
    if (isNil(cameras[0]?.spacesToNext)) {
      totalToBooth = null;
    } else {
      totalToBooth = 0;
      cameras.find((candidate) => {
        const { spacesToNext } = candidate;
        if (isNull(spacesToNext)) {
          return true;
        }
        totalToBooth = Number(totalToBooth) + (candidate?.spacesToNext ?? 0);
        return candidate === camera;
      });
    }

    return (
      <li
        className={clsx("flex flex-col", "relative", !isFirst && "pt-8")}
        key={id}
      >
        <div
          className="bg-lighten-lower w-full relative"
          style={{
            paddingTop: `${(image.height / image.width) * 100}%`,
          }}
        >
          <img
            src={`${image.url}?${cameraTime}`}
            className={clsx(
              "absolute inset-0 w-full",
              owner?.name && "border border-black"
            )}
            alt={`Traffic Camera: ${title}`}
          />
        </div>
        <span className="font-bold text-lg mt-2">
          <a
            href={mapsUrl}
            target="_blank"
            className="link"
            rel="noopener noreferrer"
          >
            {title}
          </a>
          {Boolean(totalToBooth) && (
            <span className={clsx("ml-4 font-normal text-sm")}>
              <CarIcon className="inline-block mr-2" />
              {totalToBooth} to tollbooth
            </span>
          )}
          {totalToBooth === 0 && (
            <span className={clsx("ml-4 font-normal text-sm")}>
              <ParkingIcon className="inline-block mr-2" />
              Past tollbooth
            </span>
          )}
        </span>
        {isFirst && (
          <div
            className={clsx(
              "bg-green-dark",
              "w-12 h-full",
              "absolute bottom-0 left-0 -ml-12 z-10"
            )}
          />
        )}
        <div
          className={clsx(
            "bg-green-dark text-lighten-medium",
            "w-12 py-2",
            "absolute bottom-0 left-0 -ml-12 -mb-2 z-10",
            "text-center"
          )}
        >
          <MapIcon className="text-2xl inline-block ml-1" />
        </div>
        {Boolean(spacesToNext) && (
          <div
            className={clsx(
              "bg-green-dark",
              "w-12 py-1",
              "absolute top-0 left-0 -ml-12 mt-1/3 z-10",
              "text-center"
            )}
          >
            <div className="flex flex-col ml-1 items-center">
              <CarIcon className="inline-block" />
              <span className="text-sm">{spacesToNext}</span>
            </div>
          </div>
        )}
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
      >
        <span className="text-center flex-1">{terminal.name} Cameras</span>
        <ReloadButton
          onClick={() => reload()}
          ariaLabel="Reload Cameras"
          isReloading={false}
        />
      </Header>
      <main
        className="flex-grow overflow-y-scroll scrolling-touch text-white"
        ref={wrapper}
      >
        <div className={clsx("my-4 pl-12 relative max-w-lg")}>
          <div
            className={clsx(
              "bg-green-dark",
              "border-l-4 border-dotted border-lighten-medium",
              "w-1 h-full",
              "absolute inset-y-0 left-0 ml-6"
            )}
          />
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

          <ul>{cameras.map(renderCamera)}</ul>
        </div>
      </main>
    </>
  );
};
