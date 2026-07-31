import clsx from "clsx";
import React, { FunctionComponent, ReactElement, SVGAttributes } from "react";
import { Link } from "react-router-dom";

export interface ShareOptions {
  sharedText: string;
  shareButtonText: string;
}

interface Props {
  item: MenuItem;
}

interface Spacer {
  isSpacer: boolean;
}

interface BaseMenuItem {
  Icon: FunctionComponent<SVGAttributes<SVGElement>>;
  label: string;
  isBottom?: boolean;
}

interface InternalLinkMenuItem extends BaseMenuItem {
  path: string;
}

interface ExternalLinkMenuItem extends BaseMenuItem {
  url: string;
}

interface ButtonMenuItem extends BaseMenuItem {
  onClick: () => void;
}

export type MenuItem =
  | InternalLinkMenuItem
  | ExternalLinkMenuItem
  | ButtonMenuItem
  | Spacer;

export const MenuItem = ({ item }: Props): ReactElement | null => {
  if ("isSpacer" in item) {
    return <li aria-hidden="true" className="flex-grow" />;
  }

  const { Icon, label } = item;
  const itemClass = "w-full";
  const wrapperClass = clsx(
    "flex py-4 px-5 cursor-pointer",
    "border-l-4 border-transparent",
    "hover:border-countdown hover:bg-lighten-lower",
    {
      "text-lighten-highest": "isBottom" in item,
    }
  );
  const content = (
    <>
      <Icon className="mr-6 w-6 shrink-0 text-center text-2xl" />
      <span className="flex-grow text-xl">{label}</span>
    </>
  );

  if ("path" in item) {
    return (
      <li key={label} className={itemClass}>
        <Link to={item.path} className={wrapperClass}>
          {content}
        </Link>
      </li>
    );
  } else if ("url" in item) {
    return (
      <li key={label} className={itemClass}>
        <a
          href={item.url}
          className={wrapperClass}
          target="_blank"
          rel="noreferrer"
        >
          {content}
        </a>
      </li>
    );
  } else {
    return (
      <li key={label} className={itemClass}>
        <div onClick={item.onClick} className={wrapperClass}>
          {content}
        </div>
      </li>
    );
  }
};
