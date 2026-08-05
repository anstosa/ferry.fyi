import React, { type ReactElement, useState } from "react";
import { getSeoMetadata } from "shared/lib/seo";

import { AdSlot } from "~/components/AdSlot";
import { HomeHero } from "~/components/HomeHero";
import { HomeTerminalDirectory } from "~/components/HomeTerminalDirectory";
import { SeoHelmet } from "~/components/SeoHelmet";
import { useFavoriteRoutes } from "~/lib/favoriteRoutes";
import { useFeatureFlags } from "~/lib/featureFlags";
import { useAppRenderContext } from "~/lib/renderContext";
import { useTerminals } from "~/lib/terminals";
import MenuIcon from "~/static/images/icons/solid/bars.svg";
import { Menu } from "~/views/Menu";

import { Today } from "./Today";

// homepage route groups
export const Home = (): ReactElement => {
  // alternate host guard
  const { seoHost } = useAppRenderContext();
  if (seoHost === "howmanyboats.today") {
    return <Today />;
  }
  const { terminals, closestTerminal } = useTerminals({
    usePublicDirectorySeed: true,
  });
  const [favoriteRouteIds] = useFavoriteRoutes();
  const [isMenuOpen, setMenuOpen] = useState(false);
  const { leaderboardsEnabled } = useFeatureFlags();
  return (
    <main className="relative min-h-screen min-h-[100dvh] overflow-y-scroll scrolling-touch bg-ferry-gradient text-white">
      <SeoHelmet seo={getSeoMetadata("/")} />
      <Menu
        hasTopBanner={false}
        isOpen={isMenuOpen}
        onClose={() => setMenuOpen(false)}
        onOpen={() => setMenuOpen(true)}
      />
      <button
        aria-label="Open Menu"
        className="absolute top-0 left-0 z-20 mt-safe-top p-4 text-2xl hover:bg-lighten-high"
        onClick={() => setMenuOpen(true)}
        type="button"
      >
        <MenuIcon />
      </button>
      <HomeHero leaderboardsEnabled={leaderboardsEnabled} />
      <AdSlot
        className="mx-auto w-full max-w-6xl px-4 pb-4"
        contextLabel="Home"
        slot="home"
      />
      <HomeTerminalDirectory
        closestTerminal={closestTerminal}
        favoriteRouteIds={favoriteRouteIds}
        showLoadingState
        terminals={terminals}
      />
    </main>
  );
};
