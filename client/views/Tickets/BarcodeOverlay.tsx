import { ReservationAccount, TicketStorage } from "shared/contracts/tickets";
import { Share } from "@capacitor/share";
import clsx from "clsx";
import JsBarcode from "jsbarcode";
import logo from "~/static/images/icon_monochrome.png";
import React, { ReactElement, useEffect, useRef, useState } from "react";
import RemoveConfirmIcon from "~/static/images/icons/solid/exclamation-square.svg";
import RemoveIcon from "~/static/images/icons/solid/trash.svg";
import ShareIcon from "~/static/images/icons/solid/share-square.svg";
import StopIcon from "~/static/images/icons/solid/times.svg";

interface Props {
  ticket: TicketStorage | ReservationAccount;
  onDelete: (ticket: TicketStorage | ReservationAccount) => Promise<void>;
  onClose: () => void;
}

export const BarcodeOverlay = ({
  ticket,
  onClose,
  onDelete,
}: Props): ReactElement | null => {
  const barcodeRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (barcodeRef.current && ticket?.id) {
      // eslint-disable-next-line new-cap
      JsBarcode(barcodeRef.current, ticket?.id);
    }
  }, [barcodeRef.current, ticket?.id]);

  // track whether we have native sharing available
  const [canShare, setShare] = useState<boolean>(false);
  useEffect(() => {
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

  if (!ticket) {
    return null;
  }

  return (
    <div
      className={clsx(
        "z-20 fixed inset-0",
        "w-full h-full",
        "bg-darken-high",
        "flex flex-col items-center justify-center"
      )}
      onClick={() => onClose()}
    >
      <button
        className="absolute top-5 right-5 text-2xl"
        onClick={() => onClose()}
      >
        <StopIcon className="text-xl" />
      </button>
      <div
        className={clsx(
          "bg-green-dark text-white",
          "text-2xl px-10 py-4 font-bold",
          "w-full max-w-lg rounded-t",
          "flex items-center"
        )}
      >
        <img src={logo} className="inline-block mr-4 w-10" />
        Ferry FYI
      </div>
      <div
        className={clsx("gradient-green-to-bottom", "w-full max-w-lg h-10")}
      />
      <div
        className={clsx(
          "rounded-b px-10 py-4 bg-white text-black",
          "w-full max-w-lg relative",
          "flex flex-col items-center"
        )}
      >
        {"description" in ticket && (
          <span className="font-mono font-bold">{ticket.description}</span>
        )}
        {ticket.type === "reservation" && (
          <span className="font-mono font-bold">Reservation Account</span>
        )}
        <svg ref={barcodeRef} />
        <div
          className={clsx(
            "flex items-center justify-center gap-10",
            "absolute bottom-0 p-10 -mb-28",
            "text-2xl text-white"
          )}
        >
          {canShare && (
            <button
              onClick={async (event) => {
                event.stopPropagation();
                const sharedText =
                  ticket.type === "ticket"
                    ? ticket.description
                    : "Reservation Account";
                try {
                  await Share.share({
                    title: "Shared Ticket on Ferry FYI",
                    text: sharedText,
                    url: `${process.env.BASE_URL}/tickets?add=${ticket.id}`,
                    dialogTitle: sharedText,
                  });
                } catch (error) {
                  console.error("Failed to share", error);
                }
              }}
            >
              <ShareIcon />
            </button>
          )}
          <button
            onClick={async (event) => {
              event.stopPropagation();
              if (isDeleting === ticket.id) {
                setDeleting(null);
                await onDelete(ticket);
              } else {
                setDeleting(ticket.id);
              }
            }}
          >
            {isDeleting === ticket.id ? <RemoveConfirmIcon /> : <RemoveIcon />}
          </button>
        </div>
      </div>
    </div>
  );
};
