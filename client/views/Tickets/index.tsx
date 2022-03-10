import { atomWithStorage } from "jotai/utils";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { BarcodeOverlay } from "./BarcodeOverlay";
import {
  BarcodeScanner,
  SupportedFormat,
} from "@capacitor-community/barcode-scanner";
import {
  BrowserCodeReader,
  BrowserMultiFormatOneDReader,
  IScannerControls,
} from "@zxing/browser";
import { get } from "~/lib/api";
import { Helmet } from "react-helmet";
import { KeepAwake } from "@capacitor-community/keep-awake";
import { LoginPrompt } from "./LoginPrompt";
import { Page } from "~/components/Page";
import {
  ReservationAccount,
  TicketStorage,
  Ticket as TicketType,
} from "shared/contracts/tickets";
import { ScreenBrightness } from "@capacitor-community/screen-brightness";
import { sortBy, without } from "shared/lib/arrays";
import { Splash } from "~/components/Splash";
import { Ticket } from "./Ticket";
import { useAtom } from "jotai";
import { useDevice } from "~/lib/device";
import { useQuery } from "~/lib/browser";
import { useUser } from "~/lib/user";
import clsx from "clsx";
import ErrorIcon from "~/static/images/icons/solid/exclamation-triangle.svg";
import React, { ReactElement, useEffect, useRef, useState } from "react";
import ScanIcon from "~/static/images/icons/solid/barcode-scan.svg";
import StopIcon from "~/static/images/icons/solid/times.svg";
import UploadIcon from "~/static/images/icons/solid/image.svg";

const hints = new Map();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);

const ticketsAtom = atomWithStorage<Array<TicketStorage | ReservationAccount>>(
  "tickets",
  []
);

export const Tickets = (): ReactElement => {
  const [selectedCameraId, setSelectedCameraId] = useState<string | undefined>(
    undefined
  );
  const [controls, setControls] = useState<IScannerControls | null>(null);
  const [, setCameras] = useState<MediaDeviceInfo[]>([]);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const [reader] = useState(new BrowserMultiFormatOneDReader(hints));
  const [tickets, setTickets] = useAtom(ticketsAtom);
  const [ticketNumber, setTicketNumber] = useState<string>("");
  const [isScanning, setScanning] = useState<boolean>(false);
  const [isAdding, setAdding] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<
    TicketStorage | ReservationAccount | null
  >(null);
  const [brightness, setBrightness] = useState<number>(0.5);
  const { add: codeInput } = useQuery();
  const device = useDevice();
  const [{ tickets: savedTickets }, { updateUser }] = useUser();

  // add saved tickets from cloud
  useEffect(() => {
    savedTickets?.forEach(addCode);
  }, [savedTickets]);

  const fetchCameras = async () => {
    const cameras = await BrowserCodeReader.listVideoInputDevices();
    setCameras(cameras);

    const rearCamera = cameras.find(({ label }) =>
      /back|trás|rear|traseira|environment|ambiente/gi.test(label)
    );

    setSelectedCameraId((rearCamera || cameras.pop())?.deviceId);
  };

  const updateTickets = async () => {
    await Promise.all(
      tickets.map(async (ticket) => {
        if (ticket.type === "ticket") {
          const data = await get<TicketType>(`/tickets/${ticket.id}`);
          setTickets((tickets) => [
            ...without(tickets, ticket),
            {
              type: "ticket",
              ...data,
            },
          ]);
        }
      })
    );
  };

  useEffect(() => {
    fetchCameras();
    updateTickets();
    if (codeInput) {
      addCode(codeInput);
    }

    return () => {
      stopScanning(controls);
    };
  }, []);

  if (!device) {
    return <Splash />;
  }

  const openOverlay = async (ticket: TicketStorage | ReservationAccount) => {
    setExpanded(ticket);
    if (device?.platform === "android" || device?.platform === "ios") {
      setBrightness((await ScreenBrightness.getBrightness()).brightness);
      ScreenBrightness.setBrightness({ brightness: 1 });
    }
    KeepAwake.keepAwake();
  };

  const closeOverlay = () => {
    setExpanded(null);
    if (device?.platform === "android" || device?.platform === "ios") {
      ScreenBrightness.setBrightness({ brightness });
    }
    KeepAwake.allowSleep();
  };

  const addCode = async (code: string) => {
    // if this code is already in the list, don't add it again
    if (tickets.find(({ id }) => id === code)) {
      return;
    }

    if (code.startsWith("R")) {
      setTickets((tickets) => [
        ...tickets,
        {
          type: "reservation",
          id: code,
        },
      ]);
    } else {
      setAdding(true);
      try {
        const ticket = await get<TicketType>(`/tickets/${code}`);
        setTickets((tickets) => [
          ...tickets,
          {
            type: "ticket",
            ...ticket,
          },
        ]);
      } catch (error) {}
      setAdding(false);
    }
    // if this code isn't on the user, set it
    console.log(savedTickets, code);
    if (!savedTickets || !savedTickets.includes(code)) {
      await updateUser({
        app_metadata: { tickets: [...(savedTickets ?? []), code] },
      });
    }
  };

  const stopScanning = (inputControls = controls) => {
    if (inputControls) {
      inputControls.stop();
      setControls(null);
    }
    setTicketNumber("");
    setScanning(false);

    if (device.platform !== "web") {
      document.body.classList.remove("hidden");
      BarcodeScanner.showBackground();
      BarcodeScanner.stopScan();
    }
  };

  const scan = async () => {
    setScanning(true);
    if (device.platform === "web") {
      if (!selectedCameraId) {
        console.error("No camera selected!");
        return;
      }
      reader.hints.set(DecodeHintType.TRY_HARDER, false);
      setControls(
        await reader.decodeFromVideoDevice(
          selectedCameraId,
          previewRef.current ?? undefined,
          (result, error, controls) => {
            if (result) {
              stopScanning(controls);
              addCode(result.getText());
            }
          }
        )
      );
    } else {
      const status = await BarcodeScanner.checkPermission({ force: true });
      if (!status.granted) {
        console.error("Permission denied!");
        return;
      }
      document.body.classList.add("hidden");
      BarcodeScanner.hideBackground();
      const result = await BarcodeScanner.startScan({
        targetedFormats: [SupportedFormat.CODE_128],
      });

      if (result.hasContent) {
        addCode(result.content ?? "");
      }
      stopScanning(controls);
    }
  };

  return (
    <Page title="Tickets">
      <Helmet>
        <link rel="canonical" href={`${process.env.BASE_URL}/tickets`} />
      </Helmet>

      <div className="flex flex-nowrap">
        <button
          onClick={() => {
            scan();
          }}
          className="button button-invert flex-grow mt-4 w-1/2 mr-2 px-0"
        >
          <ScanIcon className="inline-block button-icon text-2xl" />
          <span className="button-label">Scan Ticket</span>
        </button>
        <label className="button button-invert flex-grow mt-4 w-1/2 ml-2 px-0">
          <UploadIcon className="inline-block button-icon text-2xl" />
          <span className="button-label">Upload Ticket</span>
          <input
            type="file"
            accept="image/*"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              reader.hints.set(DecodeHintType.TRY_HARDER, true);
              const result = await reader.decodeFromImageUrl(
                URL.createObjectURL(file)
              );
              if (result) {
                addCode(result.getText());
              } else {
                console.error("Unable to find barcode");
              }
            }}
            className="hidden"
          />
        </label>
      </div>

      <ul className="mt-4">
        {tickets.length && <LoginPrompt />}
        {isAdding && (
          <li
            className={clsx(
              "flex items-center my-4",
              "p-4 rounded cursor-pointer",
              "bg-darken-high dark:bg-lighten-high",
              "text-white dark:text-gray-900"
            )}
          >
            Adding ticket...
          </li>
        )}
        {sortBy(tickets, "id").map((ticket) => (
          <Ticket
            ticket={ticket}
            onClick={() => openOverlay(ticket)}
            key={ticket.id}
          />
        ))}
      </ul>

      {expanded && (
        <BarcodeOverlay
          ticket={expanded}
          onClose={() => closeOverlay()}
          onDelete={async (deleted) => {
            setTickets(without(tickets, deleted));
            await updateUser({
              app_metadata: { tickets: without(savedTickets, deleted.id) },
            });
          }}
        />
      )}

      <video
        ref={previewRef}
        className="z-20 fixed inset-0 w-full h-full bg-cover bg-darken-medium"
        style={{ display: controls ? "block" : "none" }}
      />

      {isScanning && (
        <>
          {!controls && (
            <div
              className={clsx(
                "z-20 fixed inset-0",
                "w-full h-full bg-cover bg-darken-medium text-2xl text-white",
                "flex items-center justify-center"
              )}
            >
              <ErrorIcon className="mr-2" />
              Camera Error
            </div>
          )}
          <button
            className="fixed z-20 top-5 right-5 text-2xl"
            onClick={() => stopScanning()}
          >
            <StopIcon />
          </button>
          <form
            className="fixed z-20 bottom-10 right-10 left-10 flex items-center"
            onSubmit={(event) => {
              event.preventDefault();
              addCode(ticketNumber);
              stopScanning();
            }}
          >
            <input
              className="field"
              type="text"
              value={ticketNumber}
              onChange={(event) => setTicketNumber(event.target.value)}
              placeholder="or manually enter ticket number"
            />
            <input
              className="button button-primary ml-4"
              type="submit"
              value="Add Ticket"
            />
          </form>
        </>
      )}
    </Page>
  );
};
