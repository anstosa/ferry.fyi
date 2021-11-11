import { motion } from "framer-motion";
import clsx from "clsx";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ReloadIcon from "~/images/icons/solid/redo.svg";

interface SpinWrapperProps {
  isLoading: boolean;
}

/**
 * Wrap the button in a component that animates it
 * 360 degree spin and makes sure that it completes the current rotation before stopping
 **/
const SpinWrapper: FunctionComponent<SpinWrapperProps> = ({
  children,
  isLoading,
}) => {
  const [isLastSpin, setLastSpin] = useState(false);
  const [isSpinning, setSpinning] = useState<boolean>(false);
  const [spinInterval, setSpinInterval] = useState<number | null>(null);

  useEffect(() => {
    if (isLoading) {
      setLastSpin(false);
      setSpinning(true);
      let spinCount = 0;
      const interval = window.setInterval(() => {
        spinCount++;
        if (isLastSpin || spinCount > 30) {
          setSpinning(false);
          if (interval) {
            window.clearInterval(interval);
          }
        }
      }, 1000);
      setSpinInterval(interval);
    } else {
      setLastSpin(true);
    }

    return () => {
      if (spinInterval) {
        window.clearInterval(spinInterval);
      }
    };
  }, [isLoading]);

  if (isSpinning) {
    return (
      <motion.div
        initial={{ transform: "rotate(0deg)" }}
        animate={{ transform: "rotate(360deg)" }}
        transition={{
          duration: 1,
          ease: "linear",
          repeat: Infinity,
        }}
      >
        {children}
      </motion.div>
    );
  } else {
    return <>children</>;
  }
};

interface Props {
  ariaLabel: string;
  isReloading: boolean;
  onClick: () => void;
}
export const ReloadButton = ({
  ariaLabel,
  isReloading,
  onClick,
}: Props): ReactElement => (
  <SpinWrapper isLoading={isReloading}>
    <ReloadIcon
      className={clsx("text-xl cursor-pointer")}
      aria-label={ariaLabel}
      onClick={onClick}
    />
  </SpinWrapper>
);
