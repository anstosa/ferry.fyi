import { motion } from "framer-motion";
import CloseIcon from "~/images/icons/solid/times.svg";
import clsx from "clsx";
import React, { FunctionComponent, SVGAttributes } from "react";

interface Props {
  onClose?: () => void;
  info?: boolean;
  warning?: boolean;
  error?: boolean;
  Icon?: FunctionComponent<SVGAttributes<SVGElement>>;
}

export const Alert: FunctionComponent<Props> = ({
  children,
  onClose,
  info,
  Icon,
  warning,
  error,
}) => {
  return (
    <motion.div
      className={clsx(
        "alert",
        "fixed bottom-0 inset-x-0 z-20",
        "sm:left-auto sm:right-10 sm:mb-24 sm:rounded sm:px-10 sm:w-auto",
        {
          "alert--info": info,
          "alert--warning": warning,
          "alert--error": error,
          "flex items-center": Boolean(Icon),
        }
      )}
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
      {Icon && <Icon className="text-4xl mr-4" />}
      {children}
    </motion.div>
  );
};
