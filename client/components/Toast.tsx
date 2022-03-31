import { atom, useAtom } from "jotai";
import { motion } from "framer-motion";
import { without } from "shared/lib/arrays";
import CloseIcon from "~/static/images/icons/solid/times.svg";
import clsx from "clsx";
import React, {
  FunctionComponent,
  SVGAttributes,
  useEffect,
  useState,
} from "react";

interface Props {
  onClose?: () => void;
  info?: boolean;
  warning?: boolean;
  error?: boolean;
  Icon?: FunctionComponent<SVGAttributes<SVGElement>>;
}

const errorsAtom = atom<string[]>([]);
const infosAtom = atom<string[]>([]);
const warningsAtom = atom<string[]>([]);

type toastHook = [
  { topId: string | null },
  {
    addToast: (level: "error" | "info" | "warning") => string;
    removeToast: (id: string) => void;
  }
];
const useToast = (): toastHook => {
  const [errors, setErrors] = useAtom(errorsAtom);
  const [infos, setInfos] = useAtom(infosAtom);
  const [warnings, setWarnings] = useAtom(warningsAtom);
  return [
    {
      topId: errors[0] ?? warnings[0] ?? infos[0] ?? null,
    },
    {
      addToast: (level: "error" | "info" | "warning"): string => {
        const id = Math.random().toString();
        if (level === "error") {
          setErrors((errors) => [...errors, id]);
        } else if (level === "warning") {
          setWarnings((warnings) => [...warnings, id]);
        } else {
          setInfos((infos) => [...infos, id]);
        }
        return id;
      },
      removeToast: (id: string): void => {
        setErrors((errors) => without(errors, id));
        setWarnings((warnings) => without(warnings, id));
        setInfos((infos) => without(infos, id));
      },
    },
  ];
};

export const Toast: FunctionComponent<Props> = ({
  children,
  onClose,
  info,
  Icon,
  warning,
  error,
}) => {
  // eslint-disable-next-line no-nested-ternary
  const level = info ? "info" : warning ? "warning" : "error";
  const [{ topId }, { addToast, removeToast }] = useToast();
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    const id = addToast(level);
    setId(id);

    return () => removeToast(id);
  }, []);

  if (!id || topId !== id) {
    return null;
  }

  return (
    <motion.div
      className={clsx(
        "alert",
        "fixed bottom-0 inset-x-0 z-20",
        "sm:left-auto sm:right-10 sm:mb-24 sm:rounded sm:px-10 sm:w-auto sm:max-w-lg",
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
