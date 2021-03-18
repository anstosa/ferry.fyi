import { DateTime } from "luxon";
import { find, isNil, isNull, map } from "lodash";
import { locationToUrl } from "~/lib/maps";
import clsx from "clsx";
import React, { FC, ReactNode, useEffect, useState } from "react";
import type { Camera } from "shared/models/cameras";
import type { Terminal } from "shared/models/terminals";

interface Props {
  cameraTime: number;
  terminal: Terminal;
}

export const Cameras: FC<Props> = (props) => {
  const {
    terminal: { cameras },
  } = props;
  const [cameraTime, setCameraTime] = useState<number>(props.cameraTime);
  const [cameraInterval, setCameraInterval] = useState<
    NodeJS.Timeout | undefined
  >();

  useEffect(() => {
    setCameraInterval(
      (setInterval(() => {
        setCameraTime(DateTime.local().toSeconds());
      }, 10 * 1000) as unknown) as NodeJS.Timeout
    );
    return () => {
      if (cameraInterval) {
        clearInterval(cameraInterval);
      }
    };
  }, []);

  useEffect(() => {
    setCameraTime(props.cameraTime);
  }, [props.cameraTime]);

  const renderCamera = (camera: Camera, index: number): ReactNode => {
    const { id, title, image, spacesToNext, location, owner } = camera;
    const isFirst = index === 0;
    let totalToBooth: number | null;
    const mapsUrl = locationToUrl(location);
    if (isNil(cameras[0]?.spacesToNext)) {
      totalToBooth = null;
    } else {
      totalToBooth = 0;
      find(cameras, (candidate) => {
        const { spacesToNext } = candidate;
        if (isNull(spacesToNext)) {
          return true;
        }
        totalToBooth =
          (totalToBooth as number) + (candidate?.spacesToNext ?? 0);
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
              <i className={clsx("fas fa-car mr-2")} />
              {totalToBooth} to tollbooth
            </span>
          )}
          {totalToBooth === 0 && (
            <span className={clsx("ml-4 font-normal text-sm")}>
              <i className={clsx("fas fa-parking mr-2")} />
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
          <i className={clsx("fas fa-lg fa-map-marker ml-1")} />
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
            <div className="flex flex-col ml-1">
              <i className={clsx("fas fa-car")} />
              <span className="text-sm">{spacesToNext}</span>
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="flex-grow overflow-y-scroll scrolling-touch">
      <div className={clsx("my-4 pl-12 relative max-w-lg")}>
        <div
          className={clsx(
            "bg-green-dark",
            "border-l-4 border-dotted border-lighten-medium",
            "w-1 h-full",
            "absolute inset-y-0 left-0 ml-6"
          )}
        />
        <ul>{map(cameras, renderCamera)}</ul>
      </div>
    </div>
  );
};
