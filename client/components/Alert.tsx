import { motion } from "framer-motion";
import CloseIcon from "~/images/icons/solid/times.svg";
import clsx from "clsx";
import React, { FunctionComponent } from "react";

interface Props {
  onClose?: () => void;
  info?: boolean;
  warning?: boolean;
  error?: boolean;
}

export const Alert: FunctionComponent<Props> = ({
  children,
  onClose,
  info,
  warning,
  error,
}) => {
  return (
    <motion.div
      className={clsx("alert", "fixed bottom-0 inset-x-0 z-20", {
        "alert--info": info,
        "alert--warning": warning,
        "alert--error": error,
      })}
      initial={{ bottom: "-100%", opacity: 0 }}
      animate={{ bottom: 0, opacity: 1 }}
      exit={{ bottom: "-100%", opacity: 0 }}
      transition={{ type: "easeInOut" }}
    >
      {onClose && (
        <CloseIcon
          className="text-lg absolute top-2 right-2 alert__close"
          onClick={() => onClose()}
        />
      )}
      {children}
    </motion.div>
  );
};
