import clsx from "clsx";
import React, {
  type AnchorHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

import ExternalLinkIcon from "~/static/images/icons/solid/external-link.svg";

interface Props extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode;
}

// external pill link
export const ExternalPillLink = ({
  children,
  className,
  rel = "noopener noreferrer",
  target = "_blank",
  ...anchorProps
}: Props): ReactElement => (
  <a
    {...anchorProps}
    className={clsx(
      "inline-flex w-fit items-center rounded-full border px-3 py-1.5 text-xs font-bold",
      "border-blue-dark text-blue-dark hover:bg-night-normal-light",
      "dark:border-[#6fb8c8] dark:text-[#6fb8c8] dark:hover:bg-[rgba(255,255,255,0.08)]",
      className
    )}
    rel={rel}
    target={target}
  >
    {children}
    <ExternalLinkIcon className="ml-2 h-3 w-3" />
  </a>
);
