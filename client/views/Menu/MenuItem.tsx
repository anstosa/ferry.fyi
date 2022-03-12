import { Link } from "react-router-dom";
import clsx from "clsx";
import React, { FunctionComponent, ReactElement, SVGAttributes } from "react";

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
    return <div className="flex-grow" />;
  }

  const { Icon, label } = item;
  const wrapperClass = clsx("flex py-4 px-6 hover:bg-lighten-lower", {
    "text-lighten-highest": "isBottom" in item,
  });
  const content = (
    <>
      {" "}
      <Icon className="mr-6 text-2xl" />
      <span className="flex-grow text-xl">{label}</span>
    </>
  );

  if ("path" in item) {
    return (
      <li key={label}>
        <Link to={item.path} className={wrapperClass}>
          {content}
        </Link>
      </li>
    );
  } else if ("url" in item) {
    return (
      <li key={label}>
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
      <li key={label}>
        <div onClick={item.onClick} className={wrapperClass}>
          {content}
        </div>
      </li>
    );
  }
};
