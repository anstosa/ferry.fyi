import clsx from "clsx";
import React, {
  CSSProperties,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CameraFrameStatus } from "shared/contracts/cameraFrames";
import type { Camera } from "shared/contracts/cameras";
import type { Terminal } from "shared/contracts/terminals";
import { isNull } from "shared/lib/identity";

import { CameraFrameFreshness } from "~/components/CameraFrameFreshness";
import { Skeleton, SkeletonGroup } from "~/components/Skeleton";
import { getCameraFrames } from "~/lib/cameras";
import { locationToUrl } from "~/lib/maps";
import { usePublicSsrSource } from "~/lib/ssrSeed";
import { getSlug, useTerminals } from "~/lib/terminals";
import CarIcon from "~/static/images/icons/solid/car.svg";
import LocationIcon from "~/static/images/icons/solid/location.svg";
import MapIcon from "~/static/images/icons/solid/map-marked.svg";
import PinIcon from "~/static/images/icons/solid/map-marker.svg";
import ShipIcon from "~/static/images/icons/solid/ship.svg";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";

import { ReloadButton } from "../components/ReloadButton";
import { TerminalDropdown } from "../components/TerminalDropdown";
import { Header } from "./Header";

interface Props {
  mate?: Terminal | null;
  setRoute: (target: string, mate?: string) => void;
  terminal: Terminal | null;
}

interface CameraListProps {
  mate?: Terminal | null;
  setRoute: Props["setRoute"];
  terminal: Terminal;
}

interface CameraCountDetails {
  count: number | null;
  label: string | null;
}

const CAMERA_REFRESH_MS = 10 * 1000;
const NO_CAMERAS_MESSAGE = "This terminal does not have cameras";

export const Cameras = ({ mate, setRoute, terminal }: Props): ReactElement => {
  // defensive isolated-render loading guard
  if (!terminal) {
    return <CamerasLoadingSkeleton />;
  }
  return <CameraList mate={mate} setRoute={setRoute} terminal={terminal} />;
};

const CamerasLoadingSkeleton = (): ReactElement => {
  return (
    <main className="flex-grow overflow-y-scroll scrolling-touch bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
      <SkeletonGroup
        className="mx-auto w-full max-w-6xl space-y-8 py-6 pl-16 pr-4"
        label="Loading cameras"
      >
        {[0, 1].map((index) => (
          <div className="w-full max-w-[480px]" key={index}>
            <Skeleton className="h-[300px] w-full" />
            <div className="space-y-2 px-1 pt-3">
              <Skeleton className="h-6 w-2/3" variant="text" />
              <Skeleton className="h-4 w-1/2" variant="text" />
            </div>
          </div>
        ))}
      </SkeletonGroup>
    </main>
  );
};

// resolve camera count
const getCameraCountDetails = (camera: Camera): CameraCountDetails => {
  const { carCapacity, carsToBoat } = camera;
  // queue-only guard
  if (isNull(carCapacity)) {
    // empty count guard
    if (isNull(carsToBoat)) {
      return { count: null, label: null };
    }
    return { count: carsToBoat, label: `${carsToBoat} cars to boat` };
  }
  return { count: carCapacity, label: `${carCapacity} car capacity` };
};

// round sailings up
const roundUpToTenth = (value: number): number => Math.ceil(value * 10) / 10;

// format sailing count
const formatSailingCount = (
  cars: number,
  vehicleCapacity?: number
): string | null => {
  // missing capacity guard
  if (!vehicleCapacity) {
    return null;
  }
  const sailings = roundUpToTenth(cars / vehicleCapacity);
  const formattedSailings = sailings.toFixed(1);
  return `${formattedSailings} sailings`;
};

// render loaded terminal
const CameraList = ({
  mate,
  setRoute,
  terminal,
}: CameraListProps): ReactElement => {
  const seededFrames = usePublicSsrSource("cameraFrames");
  const { cameras } = terminal;
  const hasCameras = cameras.length > 0;
  const activeRoute = mate
    ? Object.values(terminal.routes ?? {}).find(({ terminalIds }) => {
        // selected route match
        return (
          terminalIds.includes(terminal.id) && terminalIds.includes(mate.id)
        );
      })
    : null;
  const sailingVehicleCapacity =
    activeRoute?.normalVehicleCapacity ?? activeRoute?.averageVehicleCapacity;
  const [frameStatuses, setFrameStatuses] = useState<
    Record<string, CameraFrameStatus>
  >(() =>
    Object.fromEntries(
      Object.entries(seededFrames?.frames ?? {}).map(([id, frame]) => [
        id,
        { ...frame, error: null },
      ])
    )
  );
  const [timelineStart, setTimelineStart] = useState<number | null>(null);
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const [revealedStaleImages, setRevealedStaleImages] = useState<
    Record<string, boolean>
  >({});
  const [manualRefreshCount, setManualRefreshCount] = useState(0);
  const [isTouchDevice, setTouchDevice] = useState<boolean>(false);
  const firstMarker = useRef<HTMLDivElement | null>(null);
  const timeline = useRef<HTMLDivElement | null>(null);
  const [isTerminalOpen, setTerminalOpen] = useState<boolean>(false);
  const { terminals, closestTerminal } = useTerminals();
  // memoize camera ids
  const cameraIds = useMemo(() => {
    return cameras.map(({ id }) => {
      return id;
    });
  }, [cameras]);

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

  // refresh frame metadata
  const refreshFrameStatuses = useCallback(async (): Promise<void> => {
    // empty camera guard
    if (cameraIds.length === 0) {
      return;
    }
    const response = await getCameraFrames(cameraIds);
    setFrameStatuses(response.frames);
  }, [cameraIds]);

  // detect touch devices
  useEffect(() => {
    const coarsePointerQuery = window.matchMedia("(hover: none)");
    setTouchDevice(
      coarsePointerQuery.matches || window.navigator.maxTouchPoints > 0
    );
  }, []);

  // poll frame metadata
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let timeout: number | undefined;
    const schedule = (): void => {
      if (active && document.visibilityState === "visible") {
        timeout = window.setTimeout(poll, CAMERA_REFRESH_MS);
      }
    };
    const poll = async (): Promise<void> => {
      if (!active || inFlight || document.visibilityState !== "visible") {
        return;
      }
      inFlight = true;
      try {
        await refreshFrameStatuses();
      } catch (error) {
        console.error(error);
      } finally {
        // eslint-disable-next-line require-atomic-updates -- this effect owns the flag.
        inFlight = false;
        schedule();
      }
    };
    const handleVisibilityChange = (): void => {
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
        timeout = undefined;
      }
      if (document.visibilityState === "visible") {
        poll().catch(console.error);
      }
    };
    poll().catch(console.error);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshFrameStatuses]);

  // recalculate rail start
  useEffect(() => {
    updateTimelineStart();
  }, [terminal.id, updateTimelineStart]);

  // recalculate on resize
  useEffect(() => {
    const updateLayout = (): void => {
      updateTimelineStart();
    };
    window.addEventListener("resize", updateLayout);
    return () => {
      // remove resize listener
      window.removeEventListener("resize", updateLayout);
    };
  }, [updateTimelineStart]);

  // manual freshness check
  const reload = async (): Promise<void> => {
    setManualRefreshCount((count) => count + 1);
    try {
      await refreshFrameStatuses();
    } catch (error) {
      console.error(error);
    } finally {
      setManualRefreshCount((count) => count - 1);
    }
  };

  // track image load
  const markImageLoaded = (imageKey: string): void => {
    setLoadedImages((current) => ({ ...current, [imageKey]: true }));
  };

  // reveal stale image
  const revealStaleImage = (cameraId: string): void => {
    setRevealedStaleImages((current) => ({ ...current, [cameraId]: true }));
  };

  // render camera item
  const renderCamera = (camera: Camera, index: number): ReactNode => {
    const { id, title, image, location, owner } = camera;
    const mapsUrl = locationToUrl(location);
    const frameStatus = frameStatuses[id];
    const frameToken = frameStatus?.frameToken ?? null;
    const isStale = frameStatus?.isStale ?? false;
    const imageKey = `${id}-${frameToken ?? "initial"}`;
    const imageLoaded = loadedImages[imageKey] ?? false;
    const isStaleRevealed = revealedStaleImages[id] ?? false;
    const imageSource = frameToken
      ? `${image.url}?frame=${encodeURIComponent(frameToken)}`
      : image.url;
    const isFirst = index === 0;
    const markerRef = isFirst ? firstMarker : undefined;
    const { count: carCount, label: carCountLabel } =
      getCameraCountDetails(camera);
    const sailingCount = isNull(carCount)
      ? null
      : formatSailingCount(carCount, sailingVehicleCapacity);

    return (
      <li
        className={clsx("relative flex w-full max-w-[480px] flex-col")}
        key={id}
      >
        <div
          className={clsx(
            "group relative w-full max-w-[480px] overflow-hidden shadow-sm",
            "bg-night-normal-light dark:bg-night-normal-dark"
          )}
        >
          <img
            src={imageSource}
            className={clsx(
              "block w-full max-w-[480px] transition-[filter,opacity]",
              imageLoaded ? "h-auto" : "h-[300px] opacity-0",
              isStale &&
                !isStaleRevealed &&
                (isTouchDevice ? "blur-sm" : "blur-sm group-hover:blur-none")
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
          {/* inset image edge */}
          <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_#000]" />
          {/* stale frame warning */}
          {isStale && !isStaleRevealed && (
            <div
              className={clsx(
                "absolute inset-0 flex items-center justify-center p-4 text-center",
                "bg-[rgba(0,0,0,0.55)] text-sm font-bold text-white",
                !isTouchDevice && "transition-opacity group-hover:opacity-0"
              )}
              onClick={() => {
                // touch reveal guard
                if (isTouchDevice) {
                  revealStaleImage(id);
                }
              }}
              onKeyDown={(event) => {
                // keyboard reveal guard
                if (
                  isTouchDevice &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  revealStaleImage(id);
                }
              }}
              role={isTouchDevice ? "button" : undefined}
              tabIndex={isTouchDevice ? 0 : undefined}
            >
              Camera not updating. {isTouchDevice ? "Touch" : "Hover"} to show
              anyway.
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 z-10 flex justify-between gap-2 border border-black bg-white p-[3px] text-xs font-bold text-[#0e1e2a]">
            <span className="min-w-0 truncate" title={owner?.name ?? "WSDOT"}>
              {owner?.name ?? "WSDOT"}
            </span>
            <CameraFrameFreshness frameStatus={frameStatus} passive />
          </div>
        </div>
        <span className="relative mt-3 mb-2 flex flex-col gap-1 px-1 text-lg font-bold">
          <div
            ref={markerRef}
            className={clsx(
              "absolute top-0 left-0 -ml-[3.375rem] z-10",
              "flex h-9 w-12 items-center justify-center",
              "text-white"
            )}
          >
            <span className="absolute inset-y-0 right-0 w-screen rounded-r-full bg-green-dark shadow-sm" />
            <PinIcon className="relative z-10 text-2xl" />
          </div>
          <span className="flex min-h-9 items-center gap-3 text-gray-dark dark:text-[#e0f0f4]">
            <span className="flex-1">{title}</span>
            <a
              href={mapsUrl}
              target="_blank"
              className={clsx(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                "text-blue-dark hover:bg-night-normal-light",
                "dark:text-[#6fb8c8] dark:hover:bg-[rgba(255,255,255,0.08)]"
              )}
              rel="noopener noreferrer"
              aria-label={`Open ${title} in maps`}
            >
              <MapIcon className="text-lg" />
            </a>
          </span>
          {/* car count guard */}
          {carCountLabel && (
            <span
              className={clsx("font-normal text-sm text-black dark:text-white")}
            >
              <CarIcon className="inline-block mr-2" />
              {carCountLabel}
            </span>
          )}
          {/* sailing count guard */}
          {sailingCount && (
            <span
              className={clsx("font-normal text-sm text-black dark:text-white")}
            >
              <ShipIcon className="inline-block mr-2" />
              {sailingCount}
            </span>
          )}
        </span>
      </li>
    );
  };

  return (
    <>
      <Header
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
        <div className="flex-1 min-w-0" />
        <div className="min-w-0 text-center">
          <TerminalDropdown
            terminals={terminals
              .filter(({ id }) => {
                // current terminal guard
                return id !== terminal.id;
              })
              .map((terminal) => {
                return {
                  ...(terminal.id === closestTerminal?.id && {
                    Icon: LocationIcon,
                  }),
                  terminal,
                };
              })}
            selected={terminal}
            isOpen={isTerminalOpen}
            setOpen={setTerminalOpen}
            onSelect={(event, selectedTerminal) => {
              event.preventDefault();
              setTerminalOpen(false);
              setRoute(getSlug(selectedTerminal.id));
            }}
          />
        </div>
        <span className="ml-2 shrink-0">Cameras</span>
        <div className="flex-1 min-w-0" />
        <ReloadButton
          onClick={reload}
          ariaLabel="Reload Cameras"
          isReloading={manualRefreshCount > 0}
        />
      </Header>
      <main className="flex-grow overflow-y-scroll scrolling-touch bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
        <div
          className={clsx(
            "mx-auto relative w-full max-w-6xl",
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
                "border-l-4 border-dotted border-countdown",
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
