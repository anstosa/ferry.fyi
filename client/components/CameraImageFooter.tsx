import React, { type ReactElement } from "react";
import type { CameraFrameStatus } from "shared/contracts/cameraFrames";

import { CameraFrameFreshness } from "./CameraFrameFreshness";

interface CameraImageFooterProps {
  frameStatus?: Pick<CameraFrameStatus, "checkedAt">;
  now?: number;
  ownerName?: string | null;
  passive?: boolean;
}

/** Keeps camera ownership and freshness visible over an image in every render mode. */
export const CameraImageFooter = ({
  frameStatus,
  now,
  ownerName,
  passive = false,
}: CameraImageFooterProps): ReactElement => (
  <div
    className="absolute inset-x-0 bottom-0 z-10 flex justify-between gap-2 border border-black bg-white p-[3px] text-xs font-bold text-[#0e1e2a]"
    data-camera-image-footer="true"
  >
    <span className="min-w-0 truncate" title={ownerName ?? "WSDOT"}>
      {ownerName ?? "WSDOT"}
    </span>
    <CameraFrameFreshness
      frameStatus={frameStatus}
      now={now}
      passive={passive}
    />
  </div>
);
