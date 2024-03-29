import { Menu, ShareOptions } from "~/views/Menu";
import { MenuItem } from "./Menu/MenuItem";
import { ReloadButton } from "~/components/ReloadButton";
import clsx from "clsx";
import MenuIcon from "~/static/images/icons/solid/bars.svg";
import React, { FunctionComponent, ReactNode, useState } from "react";
import ReactGA from "react-ga4";

const WrapHeader: FunctionComponent = ({ children }) => (
  <header
    className={clsx(
      "fixed top-0 inset-x-0 z-20",
      "bg-green-dark text-white",
      "w-full shadow-lg h-16",
      "flex justify-center",
      "pr-safe-right pl-safe-left mt-safe-top"
    )}
  >
    <div className={clsx("w-full max-w-6xl p-4", "flex items-center")}>
      {children}
    </div>
  </header>
);

interface Props {
  reload?: () => void;
  isReloading?: boolean;
  share?: ShareOptions;
  items?: MenuItem[];
}

export const Header: FunctionComponent<Props> = (props) => {
  const { isReloading, reload, children, share, items } = props;
  const [isMenuOpen, setMenuOpen] = useState<boolean>(false);
  const [isFakeReloading, setFakeReloading] = useState<boolean>(false);

  const openNav = () => {
    setMenuOpen(true);
    ReactGA.event({
      category: "Navigation",
      action: "Open Menu",
    });
  };

  const renderMenuToggle = (): ReactNode => {
    if (isReloading || isFakeReloading) {
      return (
        <ReloadButton
          isReloading={isReloading || isFakeReloading}
          ariaLabel="Open Menu"
          className="mr-4"
          onClick={() => {
            setMenuOpen(true);
            ReactGA.event({
              category: "Navigation",
              action: "Open Menu",
            });
          }}
        />
      );
    } else {
      return (
        <MenuIcon
          className="text-2xl inline-block mr-4 cursor-poiner"
          onClick={openNav}
          aria-label="Open Menu"
        />
      );
    }
  };

  return (
    <>
      <div className="w-full h-safe-top" />
      <div
        className={clsx(
          "fixed top-0 inset-x-0 z-20",
          "h-safe-top",
          "bg-green-dark"
        )}
      />
      <Menu
        isOpen={isMenuOpen}
        reload={
          reload
            ? () => {
                setFakeReloading(true);
                reload();
                setTimeout(() => {
                  setFakeReloading(false);
                }, 1000);
              }
            : undefined
        }
        onClose={() => {
          setMenuOpen(false);
          ReactGA.event({
            category: "Navigation",
            action: "Close Menu",
          });
        }}
        onOpen={openNav}
        share={share}
        items={items}
      />
      <WrapHeader>
        {renderMenuToggle()}
        {children}
      </WrapHeader>
      <div
        className={clsx("h-16 w-full flex-shrink-0", "bg-white dark:bg-black")}
      />
    </>
  );
};
