import clsx from "clsx";
import React, {
  CSSProperties,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CameraFrameStatus } from "shared/contracts/cameraFrames";
import type { Camera } from "shared/contracts/cameras";
import type { Terminal } from "shared/contracts/terminals";
import { isNull } from "shared/lib/identity";

import { AdSlot } from "~/components/AdSlot";
import { CameraImageFooter } from "~/components/CameraImageFooter";
import { CameraOverview } from "~/components/CameraOverview";
import { Skeleton, SkeletonGroup } from "~/components/Skeleton";
import { getCameraFrames } from "~/lib/cameras";
import { locationToUrl } from "~/lib/maps";
import { usePublicSsrSource } from "~/lib/ssrSeed";
import { getSlug, useTerminals } from "~/lib/terminals";
import { useUsefulContent } from "~/lib/usefulVisits";
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
const NO_CAMERAS_MESSAGE =
  "Camera views are not available in Ferry FYI for this terminal.";

export const Cameras = ({ mate, setRoute, terminal }: Props): ReactElement => {
  // defensive isolated-render loading guard
  if (!terminal) {
    return <CamerasLoadingState />;
  }
  return (
    <CameraList
      key={terminal.id}
      mate={mate}
      setRoute={setRoute}
      terminal={terminal}
    />
  );
};

const CamerasLoadingState = (): ReactElement => {
  return (
    <main className="flex-grow overflow-y-scroll scrolling-touch bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
      <p
        aria-live="polite"
        className="mx-auto w-full max-w-6xl p-4 text-sm"
        role="status"
      >
        Loading terminal camera information…
      </p>
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
    return {
      count: carsToBoat,
      label: `Camera position: ${carsToBoat} car spaces from boarding`,
    };
  }
  return {
    count: carCapacity,
    label: `Static holding capacity: ${carCapacity} cars`,
  };
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
  return `Capacity reference: ${formattedSailings} sailings`;
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
  const [hasLoadedImage, setHasLoadedImage] = useState(false);
  // invalidate successful image readiness only after an empty inventory commits
  useLayoutEffect(() => {
    // restored cameras must load before qualifying a new exposure
    if (!hasCameras) {
      setHasLoadedImage(false);
    }
  }, [hasCameras]);
  const usefulContentRef = useUsefulContent(
    "cameras",
    terminal.id,
    hasCameras && hasLoadedImage
  );
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
      // preserve anonymous unavailable states across the live-app handoff
      Object.entries(seededFrames?.frames ?? {}).map(([id, frame]) => [
        id,
        {
          ...frame,
          error: frame.status === "unavailable" ? "unavailable" : null,
        },
      ])
    )
  );
  const [timelineStart, setTimelineStart] = useState<number | null>(null);
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const [imageSizes, setImageSizes] = useState<
    Record<string, Pick<Camera["image"], "width" | "height">>
  >({});
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
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
    try {
      const response = await getCameraFrames(cameraIds);
      setFrameStatuses(response.frames);
    } catch (error) {
      // retain prior frames but mark every failed request as unverified
      setFrameStatuses((current) =>
        Object.fromEntries(
          // unknown source images stay unknown rather than indefinitely loading
          cameras.map((camera) => [
            camera.id,
            {
              ...(current[camera.id] ?? {
                cameraId: camera.id,
                frameToken: null,
                frameUpdatedAt: null,
                imageUrl: camera.image.url,
                isStale: false,
              }),
              checkedAt: Math.floor(Date.now() / 1000),
              error: "unavailable",
            },
          ])
        )
      );
      throw error;
    }
  }, [cameraIds, cameras]);

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

  // align after committed image geometry and frame warnings change
  useLayoutEffect(() => {
    updateTimelineStart();
  }, [cameras, frameStatuses, loadedImages, updateTimelineStart]);

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

  // retain decoded proportions for subsequent frame placeholders
  const markImageLoaded = (
    imageKey: string,
    cameraId: string,
    element: HTMLImageElement
  ): void => {
    const { naturalWidth: width, naturalHeight: height } = element;
    // never replace known dimensions with an undecoded image
    if (width > 0 && height > 0) {
      setImageSizes((current) => ({
        ...current,
        [cameraId]: { width, height },
      }));
    }
    setHasLoadedImage(true);
    setLoadedImages((current) => ({ ...current, [imageKey]: true }));
    setFailedImages((current) => ({ ...current, [imageKey]: false }));
  };

  // settle one broken image without qualifying useful content
  const markImageFailed = (imageKey: string): void => {
    setFailedImages((current) => ({ ...current, [imageKey]: true }));
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
    const isCheckFailed = Boolean(frameStatus?.error);
    const frameToken = frameStatus?.frameToken ?? null;
    const isStale = frameStatus?.isStale ?? false;
    const imageKey = `${id}-${frameToken ?? "initial"}`;
    const imageLoaded = loadedImages[imageKey] ?? false;
    const imageFailed = failedImages[imageKey] ?? false;
    const placeholderSize = imageSizes[id] ?? image;
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
          style={{
            aspectRatio: imageLoaded
              ? undefined
              : `${placeholderSize.width} / ${placeholderSize.height}`,
          }}
        >
          <img
            src={imageSource}
            className={clsx(
              "block h-auto w-full transition-[filter,opacity]",
              imageLoaded ? "opacity-100" : "absolute inset-0 opacity-0",
              isStale &&
                !isStaleRevealed &&
                (isTouchDevice ? "blur-sm" : "blur-sm group-hover:blur-none")
            )}
            alt={`Traffic camera at ${terminal.name} ferry terminal: ${title}`}
            height={image.height}
            // qualify only after a successful current-terminal image load
            onLoad={(event) => {
              markImageLoaded(imageKey, id, event.currentTarget);
            }}
            onError={() => {
              // stop the pending visual without claiming a useful image
              markImageFailed(imageKey);
            }}
            width={image.width}
          />
          {!imageLoaded && !imageFailed ? (
            <SkeletonGroup
              className="absolute inset-0"
              label={`Loading camera image for ${title}`}
            >
              <Skeleton className="h-full w-full" />
            </SkeletonGroup>
          ) : null}
          {imageFailed ? (
            <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm font-semibold text-gray-dark dark:text-gray-light">
              Camera image unavailable
            </p>
          ) : null}
          {/* inset image edge */}
          <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_#000]" />
          {/* stale frame warning */}
          {isStale && !imageFailed && !isStaleRevealed && (
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
          <CameraImageFooter
            frameStatus={frameStatus}
            ownerName={owner?.name}
            passive
          />
        </div>
        {/* identify unverified fallback images without exposing transport errors */}
        {isCheckFailed && (
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Image check failed. Treat any displayed image as last-known; current
            conditions could not be verified.
          </p>
        )}
        <div className="relative mt-3 mb-2 flex flex-col gap-1 px-1 text-lg font-bold">
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
          <div className="flex min-h-9 items-center gap-3 text-gray-dark dark:text-[#e0f0f4]">
            <h2 className="flex-1">{title}</h2>
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
          </div>
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
        </div>
      </li>
    );
  };

  return (
    <>
      <Header
        share={{
          shareSurface: "cameras",
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
        <CameraOverview mate={mate} terminal={terminal} />
        <AdSlot
          arrivalTerminalId={mate?.id}
          className="mx-auto w-full max-w-6xl px-4 pt-4"
          contextLabel={`Cameras · ${terminal.name}${mate ? ` to ${mate.name}` : ""}`}
          departureTerminalId={terminal.id}
          slot="cameras"
        />
        <div
          className={clsx(
            "mx-auto relative w-full max-w-6xl",
            hasCameras
              ? "my-4 pl-16 pr-4"
              : "p-4 text-center text-gray-dark dark:text-gray-light"
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
            <ul ref={usefulContentRef} className="flex flex-col gap-8">
              {cameras.map(renderCamera)}
            </ul>
          ) : (
            <p>{NO_CAMERAS_MESSAGE}</p>
          )}
        </div>
      </main>
    </>
  );
};
