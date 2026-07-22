import clsx from "clsx";
import React, {
  FunctionComponent,
  PropsWithChildren,
  ReactNode,
  useState,
} from "react";

import { OnboardSailingBanner } from "~/components/OnboardSailingBanner";
import { ReloadButton } from "~/components/ReloadButton";
import { trackEvent } from "~/lib/analytics";
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
    <div className={clsx("mx-auto w-full max-w-6xl p-4", "flex items-center")}>
      {children}
    </div>
  </header>
);

interface Props {
  isReloading?: boolean;
  share?: ShareOptions;
  items?: MenuItem[];
}

export const Header: FunctionComponent<PropsWithChildren<Props>> = (props) => {
  const { isReloading, children, share, items } = props;
  const [isMenuOpen, setMenuOpen] = useState<boolean>(false);
  const [hasTopBanner, setHasTopBanner] = useState<boolean>(false);

  const openNav = () => {
    setMenuOpen(true);
    trackEvent("Navigation", "Open Menu");
  };

  const renderMenuToggle = (): ReactNode => {
    if (isReloading) {
      return (
        <ReloadButton
          isReloading={isReloading}
          ariaLabel="Open Menu"
          className="mr-4"
          onClick={() => {
            setMenuOpen(true);
            trackEvent("Navigation", "Open Menu");
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
        hasTopBanner={hasTopBanner}
        isOpen={isMenuOpen}
        onClose={() => {
          setMenuOpen(false);
          trackEvent("Navigation", "Close Menu");
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
