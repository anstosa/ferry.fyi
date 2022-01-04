import { atomWithStorage } from "jotai/utils";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import {
  BrowserCodeReader,
  BrowserMultiFormatOneDReader,
  IScannerControls,
} from "@zxing/browser";
import { DateTime } from "luxon";
import { get } from "~/lib/api";
import { Helmet } from "react-helmet";
import { Page } from "../components/Page";
import { pluralize } from "shared/lib/strings";
import { sortBy, without } from "shared/lib/arrays";
import { Ticket } from "shared/contracts/tickets";
import { toShortDateString } from "~/lib/date";
import { useAtom } from "jotai";
import { useQuery } from "~/lib/browser";
import clsx from "clsx";
import ErrorIcon from "~/images/icons/solid/exclamation-triangle.svg";
import JsBarcode from "jsbarcode";
import React, {
  ReactElement,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import RemoveConfirmIcon from "~/images/icons/solid/exclamation-square.svg";
import RemoveIcon from "~/images/icons/solid/trash.svg";
import ScanIcon from "~/images/icons/solid/barcode-scan.svg";
import ShareIcon from "~/images/icons/solid/share-square.svg";
import StopIcon from "~/images/icons/solid/times.svg";
import UploadIcon from "~/images/icons/solid/image.svg";

interface TicketStorage extends Ticket {
  type: "ticket";
  nickname?: string;
}
interface ReservationAccount {
  type: "reservation";
  nickname?: string;
  id: string;
}

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
  const [isDeleting, setDeleting] = useState<string | null>(null);
  const [isScanning, setScanning] = useState<boolean>(false);
  const [isAdding, setAdding] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<
    TicketStorage | ReservationAccount | null
  >(null);
  const barcodeRef = useRef<SVGSVGElement | null>(null);
  const { add: codeInput } = useQuery();

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
          const data = await get<Ticket>(`/tickets/${ticket.id}`);
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
  }, []);

  useEffect(() => {
    if (barcodeRef.current && expanded?.id) {
      // eslint-disable-next-line new-cap
      JsBarcode(barcodeRef.current, expanded.id);
    }
  }, [barcodeRef.current, expanded?.id]);

  const closeOverlay = () => {
    setExpanded(null);
    setDeleting(null);
  };

  const addCode = async (code: string) => {
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
        const ticket = await get<Ticket>(`/tickets/${code}`);
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
  };

  const stopScanning = (inputControls = controls) => {
    if (inputControls) {
      inputControls.stop();
      setControls(null);
    }
    setTicketNumber("");
    setScanning(false);
  };

  const scan = async () => {
    setScanning(true);
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
        {isAdding && (
          <li
            className={clsx(
              "flex items-center my-4",
              "p-4 rounded-md cursor-pointer",
              "bg-darken-high dark:bg-lighten-high",
              "text-white dark:text-gray-900"
            )}
          >
            Adding ticket...
          </li>
        )}
        {sortBy(tickets, "id").map((ticket) => {
          let name: string;
          let status: ReactNode;

          if (ticket.type === "ticket") {
            const isValid = ticket.status === "Valid";
            const expirationDate = DateTime.fromMillis(ticket.expirationDate);
            const today = DateTime.local()
              .set({
                hour: 3,
                minute: 0,
                second: 0,
                millisecond: 0,
              })
              .plus({ day: 1 });
            const isExpired = expirationDate < today;
            name = ticket.nickname || ticket.description;
            status = (
              <div className="flex items-center text-sm mt-2 justify-between">
                {!isValid && (
                  <span
                    className={clsx(
                      "px-2 py-1 text-white font-bold mr-2 rounded",
                      {
                        "bg-red-800": !isValid,
                      }
                    )}
                  >
                    Invalid
                  </span>
                )}
                {(isValid || isExpired) && (
                  <span
                    className={clsx("mr-2", {
                      "text-red-600 font-bold": isExpired,
                    })}
                  >
                    {isExpired
                      ? "Expired!"
                      : `Expires ${toShortDateString(expirationDate)}`}
                  </span>
                )}
                {(isValid || (!isExpired && ticket.usesRemaining === 0)) && (
                  <span
                    className={clsx({
                      "text-red-600 font-bold": ticket.usesRemaining === 0,
                    })}
                  >
                    {pluralize(ticket.usesRemaining, "use")} left
                  </span>
                )}
              </div>
            );
          } else {
            name = ticket.nickname || "Reservation Account";
            status = (
              <span className="italic text-sm mt-2">
                Same for all reservations
              </span>
            );
          }

          return (
            <li
              className={clsx(
                "flex items-center my-4",
                "p-4 rounded-md cursor-pointer",
                "bg-darken-high dark:bg-lighten-high",
                "text-white dark:text-gray-900"
              )}
              key={ticket.id}
              onClick={() => setExpanded(ticket)}
            >
              <div className={clsx("flex flex-col flex-grow")}>
                <span className="text-xl">{name}</span>
                {status}
              </div>
            </li>
          );
        })}
      </ul>

      {expanded && (
        <div
          className={clsx(
            "z-20 fixed inset-0",
            "w-full h-full",
            "bg-darken-high",
            "flex flex-col items-center justify-center"
          )}
          onClick={() => closeOverlay()}
        >
          <button
            className="absolute top-5 right-5 text-2xl"
            onClick={() => closeOverlay()}
          >
            <StopIcon className="text-xl" />
          </button>
          <div className="p-10 bg-white text-black">
            <svg ref={barcodeRef} />
          </div>
          <div
            className={clsx(
              "flex items-center justify-center gap-10",
              "p-10 mt-10",
              "text-2xl text-white"
            )}
          >
            <button
              onClick={async (event) => {
                event.stopPropagation();
                try {
                  await navigator.share({
                    title: "Shared Ticket on Ferry FYI",
                    text:
                      expanded.type === "ticket"
                        ? expanded.description
                        : "Reservation Account",
                    url: `${process.env.BASE_URL}/tickets?add=${expanded.id}`,
                  });
                } catch (error) {
                  console.error("Failed to share", error);
                }
              }}
            >
              <ShareIcon />
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                if (isDeleting === expanded.id) {
                  setTickets(without(tickets, expanded));
                  setDeleting(null);
                  setExpanded(null);
                } else {
                  setDeleting(expanded.id);
                }
              }}
            >
              {isDeleting === expanded.id ? (
                <RemoveConfirmIcon />
              ) : (
                <RemoveIcon />
              )}
            </button>
          </div>
        </div>
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
