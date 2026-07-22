import { Share } from "@capacitor/share";
import { BrowserQRCodeSvgWriter } from "@zxing/browser";
import { EncodeHintType } from "@zxing/library";
import clsx from "clsx";
import JsBarcode from "jsbarcode";
import { DateTime } from "luxon";
import React, { ReactElement, useEffect, useRef, useState } from "react";
import {
  ReservationAccount,
  TicketCodeFormat,
  TicketStorage,
} from "shared/contracts/tickets";
import { pluralize } from "shared/lib/strings";
import { getTicketDisplayInfo } from "shared/lib/tickets";

import { FreshnessPill } from "~/components/FreshnessPill";
import { Toast } from "~/components/Toast";
import logo from "~/static/images/icon_monochrome.png";
import RemoveConfirmIcon from "~/static/images/icons/solid/exclamation-square.svg";
import ShareIcon from "~/static/images/icons/solid/share-alt.svg";
import StopIcon from "~/static/images/icons/solid/times.svg";
import RemoveIcon from "~/static/images/icons/solid/trash.svg";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";

interface Props {
  ticket: TicketStorage | ReservationAccount;
  onDelete: (ticket: TicketStorage | ReservationAccount) => Promise<void>;
  onRefresh?: () => Promise<void>;
  onClose: () => void;
}

interface ConfirmationState {
  action: "share" | "delete";
  message: string;
  primaryLabel: string;
  title: string;
}

interface PassDetail {
  label: string;
  tone: "green" | "red" | "yellow";
}

const QR_CODE_SIZE = 224;
const QR_CODE_HINTS = new Map([[EncodeHintType.MARGIN, 0]]);
const PASS_DETAIL_CLASSES: Record<PassDetail["tone"], string> = {
  green: "bg-green-lightest text-green-dark",
  red: "bg-red-light text-red-dark",
  yellow: "bg-yellow-lightest text-yellow-darkest",
};
const LIGHT_SURFACE_SECONDARY_BUTTON =
  "button-secondary bg-gray-lightest text-gray-dark hover:bg-white hover:text-gray-darkest dark:bg-gray-lightest dark:text-gray-dark dark:hover:bg-white dark:hover:text-gray-darkest";

// multi-ride text terms
const MULTI_RIDE_PATTERN =
  /\b(?:multi|passes?|commuter|monthly|\d+[- ]?rides?|ten[- ]?rides?|twenty[- ]?rides?)\b/i;

// multi-ride detector
const isMultiRideTicket = (ticket: TicketStorage): boolean => {
  const passText = `${ticket.description} ${ticket.name} ${ticket.plu}`;

  // QR fallback pass
  if (ticket.codeFormat === "qr" && !ticket.description && !ticket.name) {
    return true;
  }

  // remaining rides guard
  if (typeof ticket.usesRemaining === "number" && ticket.usesRemaining > 1) {
    return true;
  }

  return MULTI_RIDE_PATTERN.test(passText);
};

// get display title
const getTicketTitle = (ticket: TicketStorage | ReservationAccount): string => {
  // reservation title
  if (ticket.type === "reservation") {
    return getWsfTicketTitle(ticket);
  }

  return getTicketDisplayInfo({
    description: ticket.description,
    fallbackTitle: getWsfTicketTitle(ticket),
    name: ticket.name,
    plu: ticket.plu || ticket.id,
  }).title;
};

// get display subtitle
const getTicketSubtitle = (
  ticket: TicketStorage | ReservationAccount
): string => {
  // reservation subtitle
  if (ticket.type === "reservation") {
    return `Same ${getTicketCodeLabel(ticket)} for all reservations`;
  }

  // QR value subtitle
  if (ticket.codeFormat === "qr") {
    return ticket.id;
  }

  return (
    getTicketDisplayInfo({
      description: ticket.description,
      fallbackTitle: getWsfTicketTitle(ticket),
      name: ticket.name,
      plu: ticket.plu || ticket.id,
    }).subtitle ||
    ticket.plu ||
    ticket.id
  );
};

// get display route
const getTicketRouteName = (
  ticket: TicketStorage | ReservationAccount
): string | undefined => {
  // reservation route guard
  if (ticket.type === "reservation") {
    return undefined;
  }

  return getTicketDisplayInfo({
    description: ticket.description,
    fallbackTitle: getWsfTicketTitle(ticket),
    name: ticket.name,
    plu: ticket.plu || ticket.id,
  }).routeName;
};

// get display code label
const getTicketCodeLabel = (
  ticket: TicketStorage | ReservationAccount
): string => {
  // QR code label
  if (ticket.codeFormat === "qr") {
    return "QR code";
  }

  return "barcode";
};

// get WSF product title
const getWsfTicketTitle = (
  ticket: TicketStorage | ReservationAccount
): string => {
  // reservation title
  if (ticket.type === "reservation") {
    return "WSF Reservation Account";
  }

  // product title
  if (isMultiRideTicket(ticket)) {
    return "WSF Multi-Ride Pass";
  }

  return "WSF Single-Ride Pass";
};

// format pass date
const formatPassExpirationDate = (expirationDate: DateTime): string =>
  expirationDate.toFormat("dd/MM/yyyy");

// expiration status
const getExpirationDetail = (expirationDate: DateTime): PassDetail => {
  const expirationDay = expirationDate.startOf("day");
  const today = DateTime.local().startOf("day");
  const daysUntilExpiration = Math.floor(
    expirationDay.diff(today, "days").days
  );
  const formattedExpirationDate = formatPassExpirationDate(expirationDate);

  // expired pass
  if (daysUntilExpiration < 0) {
    return {
      label: `Expired ${formattedExpirationDate}`,
      tone: "red",
    };
  }

  // safe expiration window
  if (daysUntilExpiration >= 7) {
    return {
      label: `Expires ${formattedExpirationDate}`,
      tone: "green",
    };
  }

  // warning expiration window
  if (daysUntilExpiration >= 1) {
    return {
      label: `Expires ${formattedExpirationDate}`,
      tone: "yellow",
    };
  }

  return {
    label: `Expires ${formattedExpirationDate}`,
    tone: "yellow",
  };
};

// ride status
const getRideDetail = (
  usesRemaining: number,
  isMultiRide: boolean
): PassDetail => {
  // single ride state
  if (!isMultiRide) {
    return {
      label: usesRemaining > 0 ? "Unused" : "Used",
      tone: usesRemaining > 0 ? "green" : "red",
    };
  }

  // plenty of rides
  if (usesRemaining >= 5) {
    return {
      label: `${pluralize(usesRemaining, "ride")} remaining`,
      tone: "green",
    };
  }

  // low rides
  if (usesRemaining >= 1) {
    return {
      label: `${pluralize(usesRemaining, "ride")} remaining`,
      tone: "yellow",
    };
  }

  return {
    label: `${pluralize(usesRemaining, "ride")} remaining`,
    tone: "red",
  };
};

// pass detail labels
const getPassDetails = (
  ticket: TicketStorage | ReservationAccount
): PassDetail[] => {
  // ticket detail guard
  if (ticket.type !== "ticket") {
    return [];
  }

  const details: PassDetail[] = [];
  const isMultiRide = isMultiRideTicket(ticket);

  // usage label first
  if (typeof ticket.usesRemaining === "number") {
    details.push(getRideDetail(ticket.usesRemaining, isMultiRide));
  }

  // expiration label
  if (typeof ticket.expirationDate === "number") {
    details.push(
      getExpirationDetail(DateTime.fromMillis(ticket.expirationDate))
    );
  }

  return details;
};

// trim QR whitespace
const trimQrSvgPadding = (svg: SVGSVGElement): void => {
  const rects = Array.from(svg.querySelectorAll("rect"));

  // empty SVG guard
  if (rects.length === 0) {
    return;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let maxY = 0;

  rects.forEach((rect) => {
    const x = Number(rect.getAttribute("x"));
    const y = Number(rect.getAttribute("y"));
    const width = Number(rect.getAttribute("width"));
    const height = Number(rect.getAttribute("height"));

    // invalid rect guard
    if (
      Number.isNaN(x) ||
      Number.isNaN(y) ||
      Number.isNaN(width) ||
      Number.isNaN(height)
    ) {
      return;
    }

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  });

  // bounds guard
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return;
  }

  svg.setAttribute("viewBox", `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
};

// render QR code
const renderQrCode = (container: HTMLDivElement, code: string): void => {
  const writer = new BrowserQRCodeSvgWriter();
  const svg = writer.write(code, QR_CODE_SIZE, QR_CODE_SIZE, QR_CODE_HINTS);
  svg.setAttribute("class", "h-56 w-56 max-w-full");
  trimQrSvgPadding(svg);
  container.replaceChildren(svg);
};

// render barcode
const renderBarcode = (
  container: HTMLDivElement,
  code: string,
  codeFormat: TicketCodeFormat
): void => {
  // QR render path
  if (codeFormat === "qr") {
    renderQrCode(container, code);
    return;
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

  try {
    // eslint-disable-next-line new-cap
    JsBarcode(svg, code, {
      background: "transparent",
      displayValue: true,
      font: "monospace",
      fontOptions: "bold",
      fontSize: 16,
      height: 96,
      margin: 0,
      textMargin: 12,
      width: 2,
    });
    svg.setAttribute("class", "max-w-full");
    container.replaceChildren(svg);
  } catch {
    renderQrCode(container, code);
  }
};

export const BarcodeOverlay = ({
  ticket,
  onClose,
  onDelete,
  onRefresh,
}: Props): ReactElement | null => {
  const codeContainerRef = useRef<HTMLDivElement | null>(null);
  const ticketTitle = getTicketTitle(ticket);
  const ticketSubtitle = getTicketSubtitle(ticket);
  const ticketRouteName = getTicketRouteName(ticket);
  const ticketCodeLabel = getTicketCodeLabel(ticket);
  const isQrCode = ticket.codeFormat === "qr";
  // account theme variant
  const isReservationAccount = ticket.type === "reservation";
  // multi-ride theme variant
  const isMultiRideProduct =
    ticket.type === "ticket" && isMultiRideTicket(ticket);
  const passDetails = getPassDetails(ticket);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(
    null
  );
  const [isRefreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);

  const refresh = async (): Promise<void> => {
    if (!onRefresh) {
      return;
    }
    setRefreshing(true);
    setRefreshError(false);
    try {
      await onRefresh();
    } catch (error) {
      setRefreshError(true);
      throw error;
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const codeContainer = codeContainerRef.current;

    // code render guard
    if (codeContainer && ticket?.id) {
      renderBarcode(codeContainer, ticket.id, ticket.codeFormat ?? "barcode");
    }
  }, [ticket?.codeFormat, ticket?.id]);

  // track whether we have native sharing available
  const [canShare, setShare] = useState<boolean>(false);
  useEffect(() => {
    // initialize sharing
    const initShare = async () => {
      const { value: canShare } = await Share.canShare();
      setShare(canShare);
    };
    initShare();
  }, []);

  // track deleting state
  const [isDeleting, setDeleting] = useState<string | null>(null);
  useEffect(() => {
    return () => setDeleting(null);
  }, []);

  // missing ticket guard
  if (!ticket) {
    return null;
  }

  // share current ticket immediately
  const shareTicketNow = async () => {
    const sharedText = ticketTitle;
    const query = new URLSearchParams({
      add: ticket.id,
      format: ticket.codeFormat ?? "barcode",
    });

    try {
      await Share.share({
        title: "Shared Ticket on Ferry FYI",
        text: sharedText,
        url: `${process.env.BASE_URL}/tickets?${query.toString()}`,
        dialogTitle: sharedText,
      });
    } catch (error) {
      console.error("Failed to share", error);
    }
  };

  // share current ticket
  const shareTicket = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    // reservation warning
    if (ticket.type === "reservation") {
      setConfirmation({
        action: "share",
        message:
          "Reservation account codes do not change. Sharing this code will also give the recipient access to any future reservations you make.",
        primaryLabel: "Share anyway",
        title: "Share reservation account?",
      });
      return;
    }

    await shareTicketNow();
  };

  // delete with confirmation
  const deleteTicket = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    // reservation warning
    if (ticket.type === "reservation") {
      setConfirmation({
        action: "delete",
        message:
          "Reservation account codes do not change. Removing this account will remove access to the saved barcode for current and future reservations.",
        primaryLabel: "Remove",
        title: "Remove reservation account?",
      });
      return;
    }

    // confirmed delete
    if (isDeleting === ticket.id) {
      setDeleting(null);
      await onDelete(ticket);
      return;
    }

    setDeleting(ticket.id);
  };

  // run confirmation action
  const confirmAction = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    // missing confirmation guard
    if (!confirmation) {
      return;
    }

    // share confirmation
    if (confirmation.action === "share") {
      setConfirmation(null);
      await shareTicketNow();
      return;
    }

    setConfirmation(null);
    await onDelete(ticket);
  };

  // cancel confirmation
  const cancelConfirmation = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setConfirmation(null);
  };

  return (
    <div
      className={clsx(
        "fixed inset-0 z-20 flex h-full w-full items-center justify-center",
        "bg-[rgba(0,20,26,0.86)] px-4 py-8 backdrop-blur-md"
      )}
      onClick={() => onClose()}
    >
      {/* wide close control */}
      <button
        className="button button-glass button-icon-only absolute right-5 top-5 hidden text-2xl sm:flex"
        onClick={() => onClose()}
        type="button"
      >
        <StopIcon className="text-xl" />
      </button>
      <div
        className="relative flex w-full max-w-lg flex-col items-center"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className={clsx(
            "relative w-full max-w-lg overflow-hidden rounded-3xl shadow-2xl",
            "border border-white/15 bg-white text-gray-darkest"
          )}
          onClick={(event) => event.stopPropagation()}
        >
          {/* tight close control */}
          <button
            className="button button-glass button-icon-only absolute right-4 top-4 z-10 text-2xl sm:hidden"
            onClick={() => onClose()}
            type="button"
          >
            <StopIcon className="text-xl" />
          </button>
          <div
            className={clsx("relative overflow-hidden px-5 py-5", {
              // single-ride overlay theme
              "bg-[radial-gradient(circle_at_18%_12%,rgba(255,255,255,0.46)_0%,rgba(255,255,255,0.18)_22%,rgba(255,255,255,0)_42%),linear-gradient(135deg,#016f52_0%,#006f52_52%,#004d61_100%)] text-white":
                !isMultiRideProduct && !isReservationAccount,
              // multi-ride overlay theme
              "bg-[radial-gradient(circle_at_78%_14%,rgba(255,255,255,0.58)_0%,rgba(255,255,255,0.24)_22%,rgba(255,255,255,0)_42%),linear-gradient(135deg,#f2b705_0%,#c98a00_58%,#7a5400_100%)] text-white":
                isMultiRideProduct,
              // reservation overlay theme
              "bg-[radial-gradient(circle_at_58%_15%,rgba(255,255,255,0.34)_0%,rgba(255,255,255,0.12)_23%,rgba(255,255,255,0)_42%),linear-gradient(135deg,#00364a_0%,#00798b_100%)] text-white":
                isReservationAccount,
            })}
          >
            <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full bg-white/10" />
            <div className="absolute -bottom-16 left-12 h-32 w-32 rounded-full bg-yellow-medium/20 blur-sm" />
            <div className="relative grid grid-cols-[3.5rem_1fr] items-center gap-x-3 gap-y-2">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/12">
                <img
                  alt=""
                  src={logo}
                  className="h-11 w-11 rounded-xl object-contain"
                />
              </div>
              <p
                className={clsx(
                  "text-sm font-extrabold uppercase tracking-[0.2em]",
                  {
                    // multi-ride brand text
                    "text-white": isMultiRideProduct,
                    // reservation brand text
                    "text-[#b8e4f0]": isReservationAccount,
                    // default brand text
                    "text-yellow-lightest":
                      !isMultiRideProduct && !isReservationAccount,
                  }
                )}
              >
                Ferry FYI
              </p>
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/12 text-white">
                <WSDOTIcon className="h-9 w-9" aria-label="WSF" />
              </span>
              <div className="min-w-0">
                {/* route chip */}
                {ticketRouteName ? (
                  <p
                    className={clsx(
                      "mb-1 inline-flex max-w-full rounded-full px-2.5 py-1 text-2xs font-black uppercase tracking-[0.14em]",
                      {
                        // multi-ride route chip
                        "bg-white/20 text-white": isMultiRideProduct,
                        // default route chip
                        "bg-white/15 text-yellow-lightest":
                          !isMultiRideProduct && !isReservationAccount,
                      }
                    )}
                  >
                    <span className="truncate">{ticketRouteName}</span>
                  </p>
                ) : null}
                <h2
                  className={clsx(
                    "min-w-0 text-xl font-black leading-tight tracking-tight",
                    {
                      // reservation title theme
                      "text-[#b8e4f0]": isReservationAccount,
                    }
                  )}
                >
                  {ticketTitle}
                </h2>
              </div>
            </div>
          </div>

          <div className="px-5 py-5">
            {/* barcode subtitle */}
            {isQrCode ? null : (
              <p className="mx-auto mb-4 max-w-xs break-all text-center text-sm font-bold text-gray-dark">
                {ticketSubtitle}
              </p>
            )}

            {/* pass details */}
            {passDetails.length > 0 ? (
              <div className="mb-3 flex flex-wrap justify-center gap-2">
                {passDetails.map((detail) => (
                  <span
                    className={clsx(
                      "rounded-full px-3 py-1 text-sm font-bold",
                      PASS_DETAIL_CLASSES[detail.tone]
                    )}
                    key={detail.label}
                  >
                    {detail.label}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="rounded-3xl border border-[rgba(0,0,0,0.08)] bg-white p-4 shadow-inner">
              <div className="flex min-h-40 items-center justify-center rounded-2xl bg-white">
                <div
                  ref={codeContainerRef}
                  className="flex w-full items-center justify-center"
                />
              </div>
              {/* QR value */}
              {isQrCode ? (
                <p className="mx-auto mt-3 max-w-xs break-all text-center font-mono text-sm font-bold tracking-wide text-gray-dark">
                  {ticketSubtitle}
                </p>
              ) : null}
            </div>

            <p className="mt-4 text-center text-sm font-semibold text-gray-dark">
              Keep brightness up and show this {ticketCodeLabel} at the booth.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                className={clsx("button", {
                  "button-danger": isDeleting === ticket.id,
                  [LIGHT_SURFACE_SECONDARY_BUTTON]: isDeleting !== ticket.id,
                  "col-span-2": !canShare,
                })}
                onClick={deleteTicket}
                type="button"
              >
                {isDeleting === ticket.id ? (
                  <RemoveConfirmIcon />
                ) : (
                  <RemoveIcon />
                )}
                {isDeleting === ticket.id ? "Tap again to delete" : "Remove"}
              </button>
              {canShare && (
                <button
                  className="button button-primary"
                  onClick={shareTicket}
                  type="button"
                >
                  <ShareIcon />
                  Share
                </button>
              )}
            </div>
          </div>
        </div>
        {ticket.type === "ticket" && ticket.sourceUpdatedAt && onRefresh ? (
          <FreshnessPill
            className="relative z-10 mt-3 bg-white shadow-lg"
            isRefreshing={isRefreshing}
            onClick={() => {
              refresh().catch(console.error);
            }}
            sourceUpdatedAt={ticket.sourceUpdatedAt}
          />
        ) : null}
        {refreshError ? (
          <Toast error>
            Could not refresh this ticket. Showing saved data.
          </Toast>
        ) : null}
      </div>
      {confirmation ? (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(0,20,26,0.86)] px-5 backdrop-blur-md"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-white p-5 text-gray-darkest shadow-2xl">
            <h3 className="text-xl font-black text-green-dark">
              {confirmation.title}
            </h3>
            <p className="mt-3 text-sm font-semibold leading-relaxed text-gray-dark">
              {confirmation.message}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                className={clsx("button", LIGHT_SURFACE_SECONDARY_BUTTON)}
                onClick={cancelConfirmation}
                type="button"
              >
                Cancel
              </button>
              <button
                className={clsx("button", {
                  "button-primary": confirmation.action === "share",
                  "button-danger": confirmation.action === "delete",
                })}
                onClick={confirmAction}
                type="button"
              >
                {confirmation.primaryLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
