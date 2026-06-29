import clsx from "clsx";
import React, {
  FunctionComponent,
  PropsWithChildren,
  ReactNode,
  useState,
} from "react";
import ReactGA from "react-ga4";

import { OnboardSailingBanner } from "~/components/OnboardSailingBanner";
import { ReloadButton } from "~/components/ReloadButton";
import MenuIcon from "~/static/images/icons/solid/bars.svg";
import { Menu, ShareOptions } from "~/views/Menu";

import { MenuItem } from "./Menu/MenuItem";

interface WrapHeaderProps {
  hasTopBanner: boolean;
}

const WrapHeader: FunctionComponent<PropsWithChildren<WrapHeaderProps>> = ({
  children,
  hasTopBanner,
}) => (
  <header
    className={clsx(
      "fixed inset-x-0 z-20",
      "bg-ferry-header-gradient text-white",
      "w-full border-b border-[rgba(255,255,255,0.12)] shadow-lg h-16",
      "flex justify-center",
      "pr-safe-right pl-safe-left mt-safe-top"
    )}
    style={{ top: hasTopBanner ? "80px" : 0 }}
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

export const Header: FunctionComponent<PropsWithChildren<Props>> = (props) => {
  const { isReloading, reload, children, share, items } = props;
  const [isMenuOpen, setMenuOpen] = useState<boolean>(false);
  const [isFakeReloading, setFakeReloading] = useState<boolean>(false);
  const [hasTopBanner, setHasTopBanner] = useState<boolean>(false);

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
          "bg-ferry-header-gradient"
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
      <OnboardSailingBanner onVisibilityChange={setHasTopBanner} />
      <WrapHeader hasTopBanner={hasTopBanner}>
        {renderMenuToggle()}
        {children}
      </WrapHeader>
      <div
        className={clsx(
          hasTopBanner ? "h-[144px]" : "h-16",
          "w-full flex-shrink-0",
          "bg-day-normal-light dark:bg-night-normal-dark"
        )}
      />
    </>
  );
};
