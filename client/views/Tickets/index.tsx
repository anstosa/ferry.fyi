import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerAndroidScanningLibrary,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerTypeHint,
} from "@capacitor/barcode-scanner";
import { KeepAwake } from "@capacitor-community/keep-awake";
import { ScreenBrightness } from "@capacitor-community/screen-brightness";
import {
  BrowserCodeReader,
  BrowserMultiFormatReader,
  IScannerControls,
} from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import clsx from "clsx";
import { useAtom } from "jotai";
import jsQR from "jsqr";
import { DateTime } from "luxon";
import React, { ReactElement, useEffect, useRef, useState } from "react";
import type {
  ReservationAccount,
  Ticket as TicketType,
  TicketCodeFormat,
  TicketStorage,
} from "shared/contracts/tickets";
import { sortBy, without } from "shared/lib/arrays";
import { getSeoMetadata } from "shared/lib/seo";

import { ErrorBoundary } from "~/components/ErrorBoundary";
import { Page } from "~/components/Page";
import { SeoHelmet } from "~/components/SeoHelmet";
import { Splash } from "~/components/Splash";
import { ApiError, get } from "~/lib/api";
import { useQuery } from "~/lib/browser";
import { useDevice } from "~/lib/device";
import { useUser } from "~/lib/user";
import ScanIcon from "~/static/images/icons/solid/barcode-scan.svg";
import ErrorIcon from "~/static/images/icons/solid/exclamation-triangle.svg";
import ExternalLinkIcon from "~/static/images/icons/solid/external-link.svg";
import UploadIcon from "~/static/images/icons/solid/image.svg";
import ManualIcon from "~/static/images/icons/solid/keyboard.svg";
import SpinnerIcon from "~/static/images/icons/solid/spinner-third.svg";
import SyncIcon from "~/static/images/icons/solid/sync-alt.svg";
import StopIcon from "~/static/images/icons/solid/times.svg";

import { BarcodeOverlay } from "./BarcodeOverlay";
import { LoginPrompt } from "./LoginPrompt";
import { normalizeTicketList, ticketsAtom } from "./storage";
import { Ticket } from "./Ticket";

const hints = new Map();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.CODE_128,
  BarcodeFormat.QR_CODE,
]);

interface TicketCodeScan {
  code: string;
  codeFormat: TicketCodeFormat;
}

const QR_SAVED_TICKET_PREFIX = "qr:";

const HEADER_ACTION_CLASSES = clsx(
  "group flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-center backdrop-blur transition",
  "sm:flex-row sm:justify-start sm:gap-3 sm:px-3 sm:text-left",
  "border-white/20 bg-white/15 text-white hover:-translate-y-0.5 hover:bg-white/25 hover:shadow-lg"
);

const HEADER_ACTION_ICON_CLASSES = clsx(
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg transition sm:h-10 sm:w-10 sm:text-xl",
  "bg-white/15 text-yellow-lightest group-hover:bg-yellow-lightest group-hover:text-green-dark"
);

const IMAGE_DECODE_CROP_CENTERS = [
  { x: 0.32, y: 0.42 },
  { x: 0.5, y: 0.42 },
  { x: 0.68, y: 0.42 },
  { x: 0.32, y: 0.56 },
  { x: 0.5, y: 0.56 },
  { x: 0.68, y: 0.56 },
  { x: 0.32, y: 0.62 },
  { x: 0.5, y: 0.62 },
  { x: 0.68, y: 0.62 },
  { x: 0.32, y: 0.7 },
  { x: 0.5, y: 0.7 },
  { x: 0.68, y: 0.7 },
];
const IMAGE_DECODE_CROP_SCALES = [0.24, 0.32, 0.42, 0.58, 0.74];
const IMAGE_DECODE_MAX_VARIANTS = 72;
const IMAGE_DECODE_MIN_CANVAS_SIZE = 900;
const IMAGE_DECODE_MAX_CANVAS_SIZE = 1600;

// WSF purchase links
const WSF_RESERVATION_URL =
  "https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/default.aspx?op=Make+reservations";
const WSF_MULTI_RIDE_URL =
  "https://wave2go.wsdot.com/webstore/landingPage?cg=21&c=76";

// purchase button style
const PURCHASE_LINK_CLASSES = clsx(
  "button button-glass h-auto min-h-12 w-full justify-between px-4 py-3 text-left",
  "overflow-visible whitespace-normal"
);

type BrowserBarcodeDetector = {
  detect: (
    source: ImageBitmap
  ) => Promise<Array<{ format?: string; rawValue?: string }>>;
};

type BrowserBarcodeDetectorConstructor = new (options?: {
  formats?: Array<string>;
}) => BrowserBarcodeDetector;

type BarcodeDetectorWindow = Window &
  typeof globalThis & {
    BarcodeDetector?: BrowserBarcodeDetectorConstructor;
  };

interface TicketImageCropRegion {
  height: number;
  label: string;
  width: number;
  x: number;
  y: number;
}

interface TicketImageDecodeVariant {
  cleanup: () => void;
  imageData: ImageData;
  url: string;
}

// detector result format
const getTicketCodeFormatFromDetector = (format?: string): TicketCodeFormat => {
  // QR detector format
  if (format === "qr_code") {
    return "qr";
  }

  return "barcode";
};

// ZXing result format
const getTicketCodeFormatFromZxing = (
  format?: BarcodeFormat
): TicketCodeFormat => {
  // QR ZXing format
  if (format === BarcodeFormat.QR_CODE) {
    return "qr";
  }

  return "barcode";
};

// native result format
const getTicketCodeFormatFromNative = (
  format?: CapacitorBarcodeScannerTypeHint
): TicketCodeFormat => {
  // QR native format
  if (format === CapacitorBarcodeScannerTypeHint.QR_CODE) {
    return "qr";
  }

  return "barcode";
};

// encode synced ticket reference
const getSavedTicketCode = (
  code: string,
  codeFormat: TicketCodeFormat
): string => {
  // QR sync encoding
  if (codeFormat === "qr") {
    return `${QR_SAVED_TICKET_PREFIX}${encodeURIComponent(code)}`;
  }

  return code;
};

// parse synced ticket reference
const parseSavedTicketCode = (savedCode: string): TicketCodeScan => {
  // QR sync reference
  if (savedCode.startsWith(QR_SAVED_TICKET_PREFIX)) {
    try {
      return {
        code: decodeURIComponent(
          savedCode.slice(QR_SAVED_TICKET_PREFIX.length)
        ),
        codeFormat: "qr",
      };
    } catch {
      return {
        code: savedCode.slice(QR_SAVED_TICKET_PREFIX.length),
        codeFormat: "qr",
      };
    }
  }

  return {
    code: savedCode,
    codeFormat: "barcode",
  };
};

// ticket lookup path
const getTicketLookupPath = (code: string): string => {
  return `/tickets/${encodeURIComponent(code)}`;
};

// load uploaded image
const loadTicketImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    // uploaded image loaded
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    // uploaded image failed
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to load uploaded ticket image"));
    };
    image.src = url;
  });

// clamp QR crop
const getTicketImageCropRegion = (
  imageWidth: number,
  imageHeight: number,
  centerX: number,
  centerY: number,
  size: number,
  label: string
): TicketImageCropRegion => {
  const cropWidth = Math.min(size, imageWidth);
  const cropHeight = Math.min(size, imageHeight);
  const x = Math.min(
    Math.max(0, centerX * imageWidth - cropWidth / 2),
    imageWidth - cropWidth
  );
  const y = Math.min(
    Math.max(0, centerY * imageHeight - cropHeight / 2),
    imageHeight - cropHeight
  );

  return { height: cropHeight, label, width: cropWidth, x, y };
};

// choose QR crop candidates
const getTicketImageCropRegions = (
  imageWidth: number,
  imageHeight: number
): TicketImageCropRegion[] => {
  const regions: TicketImageCropRegion[] = [
    { height: imageHeight, label: "full", width: imageWidth, x: 0, y: 0 },
  ];
  const shortestSide = Math.min(imageWidth, imageHeight);
  // crop size pass
  for (const scale of IMAGE_DECODE_CROP_SCALES) {
    const cropSize = shortestSide * scale;
    // crop center pass
    for (const center of IMAGE_DECODE_CROP_CENTERS) {
      regions.push(
        getTicketImageCropRegion(
          imageWidth,
          imageHeight,
          center.x,
          center.y,
          cropSize,
          `qr-crop-${scale}-${center.x}-${center.y}`
        )
      );
    }
  }

  regions.push({
    height: imageHeight * 0.5,
    label: "ticket-band",
    width: imageWidth * 0.86,
    x: imageWidth * 0.07,
    y: imageHeight * 0.28,
  });

  const seenRegions = new Set<string>();
  return regions.filter((region) => {
    const key = [region.x, region.y, region.width, region.height]
      .map(Math.round)
      .join(":");
    // duplicate crop guard
    if (seenRegions.has(key)) {
      return false;
    }
    seenRegions.add(key);
    return true;
  });
};

// canvas blob helper
const getCanvasBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });

// render enhanced decode image
const renderTicketImageVariant = async (
  image: HTMLImageElement,
  region: TicketImageCropRegion
): Promise<TicketImageDecodeVariant | null> => {
  const largestCropSide = Math.max(region.width, region.height);
  const outputLargestSide = Math.min(
    IMAGE_DECODE_MAX_CANVAS_SIZE,
    Math.max(IMAGE_DECODE_MIN_CANVAS_SIZE, largestCropSide)
  );
  const scale = outputLargestSide / largestCropSide;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(region.width * scale);
  canvas.height = Math.round(region.height * scale);
  const context = canvas.getContext("2d");
  // canvas support guard
  if (!context) {
    return null;
  }

  context.imageSmoothingEnabled = true;
  context.drawImage(
    image,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const blob = await getCanvasBlob(canvas);
  // blob creation guard
  if (!blob) {
    return null;
  }

  const url = URL.createObjectURL(blob);
  return {
    cleanup: () => URL.revokeObjectURL(url),
    imageData,
    url,
  };
};

// build decode variants
const createTicketImageDecodeVariants = async (
  file: File
): Promise<TicketImageDecodeVariant[]> => {
  const image = await loadTicketImage(file);
  const regions = getTicketImageCropRegions(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height
  ).slice(0, IMAGE_DECODE_MAX_VARIANTS);
  const variants: TicketImageDecodeVariant[] = [];
  // render crop variants
  for (const region of regions) {
    const variant = await renderTicketImageVariant(image, region);
    // variant creation guard
    if (variant) {
      variants.push(variant);
    }
  }
  return variants;
};

// ZXing URL detector
const decodeTicketImageUrlWithZxing = async (
  reader: BrowserMultiFormatReader,
  url: string,
  tryHarder: boolean
): Promise<TicketCodeScan> => {
  // rotate fallback toggle
  if (tryHarder) {
    reader.hints.set(DecodeHintType.TRY_HARDER, true);
  } else {
    reader.hints.delete(DecodeHintType.TRY_HARDER);
  }

  const result = await reader.decodeFromImageUrl(url);
  return {
    code: result.getText(),
    codeFormat: getTicketCodeFormatFromZxing(result.getBarcodeFormat()),
  };
};

// native browser detector
const decodeTicketImageWithBarcodeDetector = async (
  file: File
): Promise<TicketCodeScan | null> => {
  const { BarcodeDetector: BarcodeDetectorConstructor } =
    window as BarcodeDetectorWindow;

  // unsupported browser guard
  if (!BarcodeDetectorConstructor || !("createImageBitmap" in window)) {
    return null;
  }

  let bitmap: ImageBitmap | null = null;

  try {
    bitmap = await createImageBitmap(file);
    const detector = new BarcodeDetectorConstructor({
      formats: ["code_128", "qr_code"],
    });
    const [barcode] = await detector.detect(bitmap);
    // detected value guard
    if (!barcode?.rawValue) {
      return null;
    }

    return {
      code: barcode.rawValue,
      codeFormat: getTicketCodeFormatFromDetector(barcode.format),
    };
  } catch {
    return null;
  } finally {
    // release bitmap memory
    bitmap?.close();
  }
};

// jsQR crop detector
const decodeTicketImageVariantWithJsQr = (
  variant: TicketImageDecodeVariant
): TicketCodeScan | null => {
  const result = jsQR(
    variant.imageData.data,
    variant.imageData.width,
    variant.imageData.height,
    { inversionAttempts: "attemptBoth" }
  );
  // jsQR result guard
  if (!result?.data) {
    return null;
  }

  return { code: result.data, codeFormat: "qr" };
};

// jsQR image detector
const decodeTicketImageVariantsWithJsQr = async (
  file: File
): Promise<TicketCodeScan | null> => {
  let variants: TicketImageDecodeVariant[] = [];

  try {
    variants = await createTicketImageDecodeVariants(file);
    // scan crop variants
    for (const variant of variants) {
      const qrResult = decodeTicketImageVariantWithJsQr(variant);
      // QR crop hit
      if (qrResult) {
        return qrResult;
      }
    }
  } finally {
    // release variant URLs
    for (const variant of variants) {
      variant.cleanup();
    }
  }

  return null;
};

// ZXing image detector
const decodeTicketImageWithZxing = async (
  reader: BrowserMultiFormatReader,
  file: File,
  tryHarder: boolean
): Promise<TicketCodeScan | null> => {
  const url = URL.createObjectURL(file);

  try {
    return await decodeTicketImageUrlWithZxing(reader, url, tryHarder);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
};

// ZXing crop detector
const decodeTicketImageVariantsWithZxing = async (
  reader: BrowserMultiFormatReader,
  file: File
): Promise<TicketCodeScan | null> => {
  let variants: TicketImageDecodeVariant[] = [];
  let lastError: unknown = null;

  try {
    variants = await createTicketImageDecodeVariants(file);
    // decode crop variants
    for (const variant of variants) {
      try {
        return await decodeTicketImageUrlWithZxing(reader, variant.url, true);
      } catch (error) {
        lastError = error;
      }
    }
  } catch (error) {
    lastError = error;
  } finally {
    // release variant URLs
    for (const variant of variants) {
      variant.cleanup();
    }
  }

  console.error("Unable to decode uploaded ticket image", lastError);
  return null;
};

// uploaded ticket detector
const decodeTicketImage = async (
  reader: BrowserMultiFormatReader,
  file: File
): Promise<TicketCodeScan | null> => {
  const detectedCode = await decodeTicketImageWithBarcodeDetector(file);

  // native detector hit
  if (detectedCode) {
    return detectedCode;
  }

  const qrVariantCode = await decodeTicketImageVariantsWithJsQr(file);

  // QR crop hit
  if (qrVariantCode) {
    return qrVariantCode;
  }

  const directCode = await decodeTicketImageWithZxing(reader, file, false);

  // direct ZXing hit
  if (directCode) {
    return directCode;
  }

  const tryHarderCode = await decodeTicketImageWithZxing(reader, file, true);

  // try-harder ZXing hit
  if (tryHarderCode) {
    return tryHarderCode;
  }

  return decodeTicketImageVariantsWithZxing(reader, file);
};

// account-first sorting
const sortTickets = (
  tickets: Array<TicketStorage | ReservationAccount>
): Array<TicketStorage | ReservationAccount> => {
  return sortBy(tickets, "id").sort((firstTicket, secondTicket) => {
    // account ordering guard
    if (firstTicket.type === secondTicket.type) {
      return 0;
    }

    return firstTicket.type === "reservation" ? -1 : 1;
  });
};

// preferred camera
const getPreferredCameraId = (
  cameras: MediaDeviceInfo[]
): string | undefined => {
  const rearCamera = cameras.find(({ label }) =>
    /back|trás|rear|traseira|environment|ambiente/gi.test(label)
  );

  return (rearCamera || cameras.at(-1))?.deviceId;
};

// WSF expiration boundary
const getTicketExpirationBoundary = (): DateTime =>
  DateTime.local()
    .set({
      hour: 3,
      minute: 0,
      second: 0,
      millisecond: 0,
    })
    .plus({ day: 1 });

// unusable ticket grouping
const isInvalidTicket = (
  ticket: TicketStorage | ReservationAccount
): boolean => {
  // reservation accounts stay active
  if (ticket.type !== "ticket") {
    return false;
  }

  const { expirationDate, usesRemaining } = ticket;

  // pending lookups stay active
  if (typeof usesRemaining !== "number") {
    return false;
  }

  // upstream invalid status
  if (ticket.status !== "Valid") {
    return true;
  }

  // expired pass
  if (
    typeof expirationDate === "number" &&
    DateTime.fromMillis(expirationDate) < getTicketExpirationBoundary()
  ) {
    return true;
  }

  return usesRemaining === 0;
};

export const Tickets = (): ReactElement => {
  const [selectedCameraId, setSelectedCameraId] = useState<string | undefined>(
    undefined
  );
  const [controls, setControls] = useState<IScannerControls | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const [reader] = useState(new BrowserMultiFormatReader(hints));
  const [tickets, setTickets] = useAtom(ticketsAtom);
  const [ticketNumber, setTicketNumber] = useState<string>("");
  const [isScanning, setScanning] = useState<boolean>(false);
  const [isAdding, setAdding] = useState<boolean>(false);
  const [isManualEntry, setManualEntry] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<
    TicketStorage | ReservationAccount | null
  >(null);
  const [showInvalidTickets, setShowInvalidTickets] = useState<boolean>(false);
  const brightnessRef = useRef<number | null>(null);
  const { add: codeInput, format: codeFormatInput } = useQuery();
  const device = useDevice();
  const [{ tickets: savedTickets }, { updateUser }] = useUser();

  // add saved tickets from cloud
  useEffect(() => {
    savedTickets?.forEach((savedCode) => {
      const ticketCode = parseSavedTicketCode(savedCode);
      addCode(ticketCode.code, {
        codeFormat: ticketCode.codeFormat,
      });
    });
  }, [savedTickets]);

  // list scanner cameras
  const fetchCameras = async (): Promise<MediaDeviceInfo[]> => {
    const cameras = await BrowserCodeReader.listVideoInputDevices();
    setCameras(cameras);
    setSelectedCameraId(getPreferredCameraId(cameras));
    return cameras;
  };

  const updateTickets = async () => {
    await Promise.all(
      tickets.map(async (ticket) => {
        if (ticket.type === "ticket") {
          try {
            const data = await get<TicketType>(getTicketLookupPath(ticket.id));
            setTickets((tickets) => [
              ...without(tickets, ticket),
              {
                ...ticket,
                ...data,
                codeFormat: ticket.codeFormat,
                id: ticket.id,
                type: "ticket",
              },
            ]);
          } catch (error) {
            // not found cleanup guard
            if (error instanceof ApiError && error.status === 404) {
              setTickets((tickets) => without(tickets, ticket));
            }
          }
        }
      })
    );
  };

  const stopScanning = (inputControls = controls) => {
    // active controls
    if (inputControls) {
      inputControls.stop();
      setControls(null);
    }
    setCameraError(null);
    setTicketNumber("");
    setScanning(false);
  };

  useEffect(() => {
    fetchCameras();
    updateTickets();
    if (codeInput) {
      addCode(decodeURIComponent(codeInput), {
        codeFormat: codeFormatInput === "qr" ? "qr" : "barcode",
      });
    }

    return () => {
      stopScanning(controls);
    };
  }, []);

  // prevent duplicate accounts
  useEffect(() => {
    const normalizedTickets = normalizeTicketList(tickets);

    // duplicate account cleanup
    if (normalizedTickets.length !== tickets.length) {
      setTickets(normalizedTickets);
    }
  }, [setTickets, tickets]);

  if (!device) {
    return <Splash />;
  }

  // maximize screen brightness
  const maximizeBrightness = async () => {
    const canAttemptBrightness =
      device.isNativeMobile ||
      device.operatingSystem === "android" ||
      device.operatingSystem === "ios";

    // unsupported platform guard
    if (!canAttemptBrightness) {
      return;
    }

    try {
      const { brightness } = await ScreenBrightness.getBrightness();
      brightnessRef.current = brightness;
      await ScreenBrightness.setBrightness({ brightness: 1 });
    } catch {}
  };

  // restore screen brightness
  const restoreBrightness = async () => {
    // stored brightness guard
    if (brightnessRef.current === null) {
      return;
    }

    const brightness = brightnessRef.current;
    brightnessRef.current = null;

    try {
      await ScreenBrightness.setBrightness({
        brightness,
      });
    } catch {}
  };

  const openOverlay = async (ticket: TicketStorage | ReservationAccount) => {
    setExpanded(ticket);
    await maximizeBrightness();
    try {
      await KeepAwake.keepAwake();
    } catch {}
  };

  const closeOverlay = async () => {
    setExpanded(null);
    await restoreBrightness();
    try {
      await KeepAwake.allowSleep();
    } catch {}
  };

  // add ticket code
  async function addCode(
    code: string,
    options: { codeFormat?: TicketCodeFormat } = {}
  ): Promise<void> {
    const codeFormat = options.codeFormat ?? "barcode";

    // existing ticket guard
    if (tickets.find(({ id }) => id === code)) {
      return;
    }

    // reservation guard
    if (code.startsWith("R")) {
      // one account guard
      if (tickets.some((ticket) => ticket.type === "reservation")) {
        return;
      }
      setTickets((tickets) => [
        ...tickets,
        {
          type: "reservation",
          id: code,
          codeFormat,
        },
      ]);
    } else {
      setAdding(true);
      try {
        const ticket = await get<TicketType>(getTicketLookupPath(code));
        setTickets((tickets) => [
          ...tickets,
          {
            ...ticket,
            codeFormat,
            id: code,
            type: "ticket",
          },
        ]);
      } catch {
        // QR fallback
        if (codeFormat === "qr") {
          setTickets((tickets) => [
            ...tickets,
            {
              type: "ticket",
              id: code,
              codeFormat,
            },
          ]);
        }
      }
      setAdding(false);
    }
    // saved user guard
    const savedTicketCode = getSavedTicketCode(code, codeFormat);
    const isSaved = savedTickets?.some(
      (savedCode) => parseSavedTicketCode(savedCode).code === code
    );
    if (!isSaved) {
      try {
        await updateUser({
          app_metadata: { tickets: [...(savedTickets ?? []), savedTicketCode] },
        });
      } catch {
        // local save fallback
      }
    }
  }

  // start browser scanner
  const startWebScanner = async (cameraId?: string): Promise<void> => {
    setScanning(true);
    setCameraError(null);
    setControls(null);
    let nextCameraId = cameraId ?? selectedCameraId;

    try {
      const availableCameras = await BrowserCodeReader.listVideoInputDevices();
      setCameras(availableCameras);
      nextCameraId = nextCameraId ?? getPreferredCameraId(availableCameras);

      // selected camera cache
      if (nextCameraId) {
        setSelectedCameraId(nextCameraId);
      }

      reader.hints.set(DecodeHintType.TRY_HARDER, false);
      const nextControls = await reader.decodeFromVideoDevice(
        nextCameraId,
        previewRef.current ?? undefined,
        (result, error, controls) => {
          // scan result
          if (result) {
            stopScanning(controls);
            addCode(result.getText(), {
              codeFormat: getTicketCodeFormatFromZxing(
                result.getBarcodeFormat()
              ),
            });
          }
        }
      );
      setControls(nextControls);

      try {
        const refreshedCameras =
          await BrowserCodeReader.listVideoInputDevices();
        setCameras(refreshedCameras);
      } catch {}
    } catch (error) {
      console.error("Unable to start camera scanner", error);
      setCameraError("Camera unavailable. Check browser camera permissions.");
    }
  };

  // switch browser scanner camera
  const switchCamera = async (): Promise<void> => {
    let availableCameras = cameras;

    try {
      availableCameras = await BrowserCodeReader.listVideoInputDevices();
      setCameras(availableCameras);
    } catch {}

    // alternate camera guard
    if (availableCameras.length < 2) {
      return;
    }

    const currentIndex = availableCameras.findIndex(
      ({ deviceId }) => deviceId === selectedCameraId
    );
    const nextIndex =
      currentIndex >= 0 ? (currentIndex + 1) % availableCameras.length : 0;
    const nextCameraId = availableCameras[nextIndex]?.deviceId;

    // next camera guard
    if (!nextCameraId) {
      return;
    }

    // active controls
    if (controls) {
      controls.stop();
      setControls(null);
    }

    setSelectedCameraId(nextCameraId);
    await startWebScanner(nextCameraId);
  };

  const scan = async () => {
    // device guard
    if (!device) {
      return;
    }
    setScanning(true);
    // web scanner
    if (device.platform === "web") {
      await startWebScanner();
    } else {
      try {
        const result = await CapacitorBarcodeScanner.scanBarcode({
          android: {
            scanningLibrary:
              CapacitorBarcodeScannerAndroidScanningLibrary.ZXING,
          },
          cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
          hint: CapacitorBarcodeScannerTypeHint.ALL,
          scanInstructions: "Scan the ticket barcode or QR code",
        });
        // native result
        if (result.ScanResult) {
          addCode(result.ScanResult, {
            codeFormat: getTicketCodeFormatFromNative(result.format),
          });
        }
      } catch {
        console.error("Unable to scan barcode");
      } finally {
        setScanning(false);
      }
    }
  };

  const normalizedTickets = normalizeTicketList(tickets);
  const sortedTickets = sortTickets(normalizedTickets);
  const activeTickets = sortedTickets.filter(
    (ticket) => !isInvalidTicket(ticket)
  );
  const invalidTickets = sortedTickets.filter(isInvalidTicket);
  const ticketCount = normalizedTickets.length;

  return (
    <Page title="Tickets">
      <SeoHelmet seo={getSeoMetadata("/tickets")} />

      <section className="mt-4 overflow-hidden rounded-2xl border border-[rgba(0,0,0,0.08)] bg-[linear-gradient(135deg,#016f52_0%,#004d61_100%)] text-white shadow-lg dark:border-[rgba(255,255,255,0.08)]">
        <div className="relative p-5 sm:p-6">
          <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10" />
          <div className="absolute -bottom-16 right-12 h-36 w-36 rounded-full bg-yellow-medium/20 blur-sm" />
          <div className="relative flex flex-col gap-5">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-yellow-lightest">
                Wallet
              </p>
              <h2 className="mt-2 text-3xl font-black tracking-tight">
                Ferry tickets, ready to scan
              </h2>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => scan()}
                className={HEADER_ACTION_CLASSES}
                type="button"
              >
                <span className={HEADER_ACTION_ICON_CLASSES}>
                  <ScanIcon className="inline-block" />
                </span>
                <span>
                  <span className="block text-sm font-black">Scan</span>
                  <span className="block text-xs font-semibold text-white/70">
                    Camera
                  </span>
                </span>
              </button>
              <label className={HEADER_ACTION_CLASSES}>
                <span className={HEADER_ACTION_ICON_CLASSES}>
                  <UploadIcon className="inline-block" />
                </span>
                <span>
                  <span className="block text-sm font-black">Upload</span>
                  <span className="block text-xs font-semibold text-white/70">
                    Image
                  </span>
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    setUploadError(null);
                    // selected file guard
                    if (!file) {
                      return;
                    }
                    event.target.value = "";
                    const result = await decodeTicketImage(reader, file);
                    // ticket code result guard
                    if (result) {
                      addCode(result.code, {
                        codeFormat: result.codeFormat,
                      });
                    } else {
                      setManualEntry(true);
                      setUploadError(
                        "We couldn't find a barcode or QR code in that image. Try a sharper screenshot or enter the ticket code manually."
                      );
                    }
                  }}
                  className="hidden"
                />
              </label>
              <button
                onClick={() => setManualEntry(true)}
                className={HEADER_ACTION_CLASSES}
                type="button"
              >
                <span className={HEADER_ACTION_ICON_CLASSES}>
                  <ManualIcon className="inline-block" />
                </span>
                <span>
                  <span className="block text-sm font-black">Manual</span>
                  <span className="block text-xs font-semibold text-white/70">
                    Type code
                  </span>
                </span>
              </button>
            </div>

            {uploadError ? (
              <div className="flex items-start gap-3 rounded-2xl border border-yellow-light/40 bg-yellow-lightest/15 p-3 text-sm font-bold text-white">
                <ErrorIcon className="mt-0.5 shrink-0 text-yellow-lightest" />
                <span>{uploadError}</span>
              </div>
            ) : null}

            {/* manual entry form */}
            {isManualEntry ? (
              <form
                className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
                onSubmit={(event) => {
                  // manual submit
                  event.preventDefault();
                  addCode(ticketNumber);
                  stopScanning();
                }}
              >
                <label className="col-span-2 flex flex-col gap-2 sm:col-span-1">
                  <span className="text-xs font-extrabold uppercase tracking-[0.18em] text-yellow-lightest">
                    Ticket number
                  </span>
                  <input
                    autoFocus
                    className="field my-0 w-full rounded-xl border border-white/20 bg-white px-4 py-3 text-lg font-bold tracking-wide text-green-dark shadow-sm dark:bg-blue-darkest dark:text-white"
                    type="text"
                    value={ticketNumber}
                    onChange={(event) => setTicketNumber(event.target.value)}
                    placeholder="Enter ticket code"
                  />
                </label>
                <button
                  className="button button-glass"
                  onClick={() => setManualEntry(false)}
                  type="button"
                >
                  Cancel
                </button>
                <input
                  className="button button-primary"
                  type="submit"
                  value="Add Ticket"
                />
              </form>
            ) : null}

            {/* purchase links */}
            {isManualEntry ? null : (
              <div>
                <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-yellow-lightest">
                  Purchase tickets
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <a
                    href={WSF_RESERVATION_URL}
                    target="_blank"
                    rel="noreferrer"
                    className={PURCHASE_LINK_CLASSES}
                  >
                    <span>Make a reservation</span>
                    <ExternalLinkIcon className="button-icon shrink-0" />
                  </a>
                  <a
                    href={WSF_MULTI_RIDE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className={PURCHASE_LINK_CLASSES}
                  >
                    <span>Buy multi-ride passes</span>
                    <ExternalLinkIcon className="button-icon shrink-0" />
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="mt-5">
        <ul className="space-y-3">
          {tickets.length ? <LoginPrompt /> : null}
          {isAdding && (
            <li className="overflow-hidden rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-4 shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 animate-pulse rounded-2xl bg-green-lightest dark:bg-white/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 animate-pulse rounded-full bg-darken-lowest dark:bg-white/10" />
                  <div className="h-3 w-48 animate-pulse rounded-full bg-darken-lowest dark:bg-white/10" />
                </div>
              </div>
            </li>
          )}
          {!ticketCount && !isAdding && (
            <li className="rounded-2xl border border-dashed border-[rgba(0,0,0,0.16)] bg-white/70 p-6 text-center shadow-sm dark:border-[rgba(255,255,255,0.18)] dark:bg-[#00202a]/70">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-lightest text-2xl text-green-dark dark:bg-white/10 dark:text-green-light">
                <ScanIcon />
              </div>
              <h3 className="text-xl font-black text-green-dark dark:text-green-light">
                No saved tickets yet
              </h3>
              <p className="mx-auto mt-2 max-w-sm text-sm font-semibold text-gray-dark dark:text-white/65">
                Scan a barcode or QR code, upload a photo, or add a ticket code
                manually to build your ferry wallet.
              </p>
            </li>
          )}
          {/* active tickets */}
          {activeTickets.map((ticket) => (
            <ErrorBoundary
              className="my-4"
              fallbackTitle="Ticket crashed"
              fallbackMessage="This ticket could not be shown. Your other tickets are still available."
              key={ticket.id}
              resetKey={ticket.id}
            >
              <Ticket ticket={ticket} onClick={() => openOverlay(ticket)} />
            </ErrorBoundary>
          ))}
          {invalidTickets.length ? (
            <li>
              <button
                className={clsx(
                  "flex w-full items-center justify-between rounded-2xl",
                  "border border-[rgba(0,0,0,0.08)] bg-white px-4 py-3",
                  "text-left text-gray-darkest shadow-sm",
                  "dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]",
                  "dark:text-white"
                )}
                onClick={() => setShowInvalidTickets((isShown) => !isShown)}
                type="button"
              >
                <span>
                  <span className="block text-sm font-black uppercase tracking-[0.16em] text-red-dark dark:text-red-light">
                    Invalid tickets
                  </span>
                  <span className="block text-sm font-semibold text-gray-dark dark:text-white/65">
                    {invalidTickets.length} hidden{" "}
                    {invalidTickets.length === 1 ? "ticket" : "tickets"}
                  </span>
                </span>
                <span className="text-sm font-black text-green-dark dark:text-green-light">
                  {showInvalidTickets ? "Hide" : "Show"}
                </span>
              </button>
            </li>
          ) : null}
          {/* invalid tickets */}
          {showInvalidTickets
            ? invalidTickets.map((ticket) => (
                <ErrorBoundary
                  className="my-4"
                  fallbackTitle="Ticket crashed"
                  fallbackMessage="This ticket could not be shown. Your other tickets are still available."
                  key={ticket.id}
                  resetKey={ticket.id}
                >
                  <Ticket ticket={ticket} onClick={() => openOverlay(ticket)} />
                </ErrorBoundary>
              ))
            : null}
        </ul>
      </section>

      {expanded && (
        <BarcodeOverlay
          ticket={expanded}
          onClose={() => closeOverlay()}
          onDelete={async (deleted) => {
            setTickets(without(tickets, deleted));
            const nextSavedTickets = savedTickets?.filter(
              (savedCode) => parseSavedTicketCode(savedCode).code !== deleted.id
            );
            try {
              await updateUser({
                app_metadata: { tickets: nextSavedTickets },
              });
            } finally {
              await closeOverlay();
            }
          }}
        />
      )}

      <video
        ref={previewRef}
        className="fixed inset-0 z-20 h-full w-full bg-black object-cover"
        style={{
          display: isScanning && device.platform === "web" ? "block" : "none",
        }}
      />

      {isScanning && device.platform === "web" && (
        <div className="fixed inset-0 z-30 flex flex-col justify-between bg-[linear-gradient(180deg,rgba(0,20,26,0.74)_0%,rgba(0,20,26,0.12)_34%,rgba(0,20,26,0.72)_100%)] px-5 py-6 text-white">
          <div className="relative z-10 flex justify-end">
            <button
              aria-label="Close scanner"
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20 bg-black/35 text-xl shadow-lg backdrop-blur transition hover:bg-black/50"
              onClick={() => stopScanning()}
              type="button"
            >
              <StopIcon />
            </button>
          </div>

          <div className="pointer-events-none relative z-10 flex flex-1 flex-col items-center justify-center gap-5 py-8">
            {controls ? (
              <div className="relative z-20 text-center drop-shadow-lg">
                <p className="text-2xl font-black">Scan your ticket</p>
                <p className="mt-2 text-sm font-semibold text-white/80">
                  Center the barcode or QR code inside the frame.
                </p>
              </div>
            ) : null}
            <div className="relative flex aspect-[1.55/1] w-full max-w-sm items-center justify-center rounded-3xl border-2 border-white/75 shadow-[0_0_0_9999px_rgba(0,0,0,0.22)]">
              <span className="absolute -left-1 -top-1 h-12 w-12 rounded-tl-3xl border-l-4 border-t-4 border-yellow-lightest" />
              <span className="absolute -right-1 -top-1 h-12 w-12 rounded-tr-3xl border-r-4 border-t-4 border-yellow-lightest" />
              <span className="absolute -bottom-1 -left-1 h-12 w-12 rounded-bl-3xl border-b-4 border-l-4 border-yellow-lightest" />
              <span className="absolute -bottom-1 -right-1 h-12 w-12 rounded-br-3xl border-b-4 border-r-4 border-yellow-lightest" />
              {controls ? null : (
                <div className="px-6 text-center drop-shadow-lg">
                  {cameraError ? (
                    <ErrorIcon className="mx-auto mb-3 text-4xl text-yellow-lightest" />
                  ) : (
                    <SpinnerIcon className="mx-auto mb-3 animate-spin text-4xl text-yellow-lightest" />
                  )}
                  <h2 className="text-xl font-black">
                    {cameraError ? "Camera unavailable" : "Starting camera"}
                  </h2>
                  <p className="mt-2 text-sm font-semibold text-white/80">
                    {cameraError ?? "Allow camera access to start scanning."}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="relative z-10 flex justify-end">
            <button
              aria-label="Switch camera"
              className={clsx(
                "flex h-14 w-14 shrink-0 items-center justify-center",
                "rounded-2xl border border-white/20 bg-yellow-lightest",
                "text-2xl text-green-dark shadow-lg transition",
                "hover:-translate-y-0.5 hover:bg-white",
                {
                  "cursor-not-allowed opacity-45": cameras.length < 2,
                }
              )}
              disabled={cameras.length < 2}
              onClick={() => switchCamera()}
              type="button"
            >
              <SyncIcon />
            </button>
          </div>
        </div>
      )}
    </Page>
  );
};
