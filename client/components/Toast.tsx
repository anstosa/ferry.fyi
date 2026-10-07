import clsx from "clsx";
import { motion } from "framer-motion";
import { atom, useAtom } from "jotai";
import React, {
  FunctionComponent,
  PropsWithChildren,
  SVGAttributes,
  useEffect,
  useRef,
  useState,
} from "react";
import { without } from "shared/lib/arrays";

import CloseIcon from "~/static/images/icons/solid/times.svg";

interface Props {
  onClose?: () => void;
  footerDocked?: boolean;
  info?: boolean;
  warning?: boolean;
  error?: boolean;
  Icon?: FunctionComponent<SVGAttributes<SVGElement>>;
  top?: boolean;
  persistent?: boolean;
}

const persistentAtom = atom<string[]>([]);
const persistentHeightAtom = atom(0);
const errorsAtom = atom<string[]>([]);
const infosAtom = atom<string[]>([]);
const warningsAtom = atom<string[]>([]);

type toastHook = [
  {
    topId: string | null;
    persistentId: string | null;
    persistentHeight: number;
  },
  {
    addToast: (level: "error" | "info" | "warning" | "persistent") => string;
    removeToast: (id: string) => void;
    setPersistentHeight: (height: number) => void;
  },
];
// reserve a separate slot for persistent update notices
const useToast = (): toastHook => {
  const [persistent, setPersistent] = useAtom(persistentAtom);
  const [persistentHeight, setPersistentHeight] = useAtom(persistentHeightAtom);
  const [errors, setErrors] = useAtom(errorsAtom);
  const [infos, setInfos] = useAtom(infosAtom);
  const [warnings, setWarnings] = useAtom(warningsAtom);
  return [
    {
      topId: errors[0] ?? warnings[0] ?? infos[0] ?? null,
      persistentId: persistent[0] ?? null,
      persistentHeight,
    },
    {
      // register toast precedence
      addToast: (
        level: "error" | "info" | "warning" | "persistent"
      ): string => {
        const id = Math.random().toString();
        // keep updates separate from operational warnings
        if (level === "persistent") {
          setPersistent((persistent) => [...persistent, id]);
          // preserve error precedence
        } else if (level === "error") {
          setErrors((errors) => [...errors, id]);
          // preserve warning precedence
        } else if (level === "warning") {
          setWarnings((warnings) => [...warnings, id]);
        } else {
          setInfos((infos) => [...infos, id]);
        }
        return id;
      },
      // restore queued prompts after unmount
      removeToast: (id: string): void => {
        setPersistent((persistent) => without(persistent, id));
        setErrors((errors) => without(errors, id));
        setWarnings((warnings) => without(warnings, id));
        setInfos((infos) => without(infos, id));
      },
      setPersistentHeight,
    },
  ];
};

// display the active toast without an implicit timeout
export const Toast: FunctionComponent<PropsWithChildren<Props>> = ({
  children,
  footerDocked,
  onClose,
  info,
  Icon,
  warning,
  error,
  top,
  persistent = false,
}) => {
  // eslint-disable-next-line no-nested-ternary
  const level = info ? "info" : warning ? "warning" : "error";
  const [
    { topId, persistentId, persistentHeight },
    { addToast, removeToast, setPersistentHeight },
  ] = useToast();
  const [id, setId] = useState<string | null>(null);
  const toastRef = useRef<HTMLDivElement>(null);

  // register and clean up this toast
  useEffect(() => {
    const id = addToast(persistent ? "persistent" : level);
    setId(id);

    return () => removeToast(id);
  }, []);

  // keep ordinary warnings above the persistent notice as its size changes
  useEffect(() => {
    const element = toastRef.current;
    // measure only the active persistent notice
    if (!persistent || !id || persistentId !== id || !element) {
      return;
    }
    // measure notice height independently of css spacing
    const measure = (): void => setPersistentHeight(element.offsetHeight);
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(element);
    // release layout space when this notice disappears
    return () => {
      observer?.disconnect();
      setPersistentHeight(0);
    };
  }, [id, persistentId, persistent]);

  // hide queued notifications within each slot
  if (!id || (persistent ? persistentId : topId) !== id) {
    return null;
  }

  // footer safe-area offset
  const bottomOffset = footerDocked
    ? "bottom-0 mb-[calc(var(--route-footer-height)+var(--safe-area-inset-bottom))]"
    : "bottom-0 mb-safe-bottom";

  return (
    <motion.div
      ref={toastRef}
      className={clsx(
        "alert",
        "fixed inset-x-0 z-20",
        top ? "top-0 sm:mt-24" : bottomOffset,
        "sm:left-auto sm:right-10 sm:rounded sm:px-10 sm:w-auto sm:max-w-lg",
        {
          "alert--info": info,
          "alert--warning": warning,
          "alert--error": error,
          "flex items-center": Boolean(Icon),
        }
      )}
      initial={{ [top ? "top" : "bottom"]: "-100%", opacity: 0 }}
      animate={{ [top ? "top" : "bottom"]: 0, opacity: 1 }}
      exit={{ [top ? "top" : "bottom"]: "-100%", opacity: 0 }}
      transition={{ ease: "easeInOut", type: "tween" }}
      style={
        !persistent && !top && persistentHeight > 0
          ? {
              marginBottom: `calc(${footerDocked ? "var(--route-footer-height) + " : ""}var(--safe-area-inset-bottom) + ${persistentHeight}px + var(--toast-stack-gap))`,
            }
          : undefined
      }
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
