import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // repo aliases
    // Most `~` imports in this mixed client/server test suite point at server.
    // Keep that default, but resolve the client-only dependencies used by the
    // Fare view before applying it so the component can be imported in jsdom.
    alias: [
      {
        find: /^~\/components\/Page$/,
        replacement: path.resolve(__dirname, "client/components/Page"),
      },
      {
        find: /^~\/components\/Skeleton$/,
        replacement: path.resolve(__dirname, "client/components/Skeleton"),
      },
      {
        find: /^~\/static\/images\/icons\/solid\/redo\.svg$/,
        replacement: path.resolve(
          __dirname,
          "client/static/images/icons/solid/redo.svg"
        ),
      },
      {
        find: /^~\/lib\/(api|adminConfirmation)$/,
        replacement: path.resolve(__dirname, "client/lib/$1"),
      },
      {
        find: /^~\/components\/DateButton$/,
        replacement: path.resolve(__dirname, "client/components/DateButton"),
      },
      {
        find: /^~\/components\/FareWizardIcons$/,
        replacement: path.resolve(
          __dirname,
          "client/components/FareWizardIcons"
        ),
      },
      {
        find: /^~\/components\/ExternalPillLink$/,
        replacement: path.resolve(
          __dirname,
          "client/components/ExternalPillLink"
        ),
      },
      {
        find: /^~\/components\/RouteSelector$/,
        replacement: path.resolve(__dirname, "client/components/RouteSelector"),
      },
      {
        find: /^~\/components\/LeaderboardForegroundCheckinWatcher$/,
        replacement: path.resolve(
          __dirname,
          "client/components/LeaderboardForegroundCheckinWatcher"
        ),
      },
      {
        find: /^~\/lib\/(featureFlags|geo|leaderboardForeground|leaderboardLocation|leaderboardNotifications|leaderboards|terminals|vessels)$/,
        replacement: path.resolve(__dirname, "client/lib/$1"),
      },
      {
        find: /^~\/lib\/fares$/,
        replacement: path.resolve(__dirname, "client/lib/fares"),
      },
      {
        find: /^~\/lib\/fareWizard$/,
        replacement: path.resolve(__dirname, "client/lib/fareWizard"),
      },
      {
        find: /^~\/static\/images\/icons\/solid\/share-alt\.svg$/,
        replacement: path.resolve(
          __dirname,
          "client/static/images/icons/solid/share-alt.svg"
        ),
      },
      {
        find: /^~\/static\/images\/icons\/solid\/check-circle\.svg$/,
        replacement: path.resolve(
          __dirname,
          "client/static/images/icons/solid/check-circle.svg"
        ),
      },
      {
        find: /^~\/static\/images\/icons\/solid\/location\.svg$/,
        replacement: path.resolve(
          __dirname,
          "client/static/images/icons/solid/location.svg"
        ),
      },
      {
        find: /^~\/static\/images\/icons\/wsdot\.svg$/,
        replacement: path.resolve(
          __dirname,
          "client/static/images/icons/wsdot.svg"
        ),
      },
      {
        find: /^~\/views\/Header$/,
        replacement: path.resolve(__dirname, "client/views/Header"),
      },
      {
        find: /^~\/components\/(.+)$/,
        replacement: path.resolve(__dirname, "client/components/$1"),
      },
      {
        find: /^~\/static\/(.+)$/,
        replacement: path.resolve(__dirname, "client/static/$1"),
      },
      {
        find: /^~\/views\/(.+)$/,
        replacement: path.resolve(__dirname, "client/views/$1"),
      },
      // Keep server-only library namespaces on the default alias below.
      {
        find: /^~\/lib\/(?!(?:admin(?:\/|$)|alertMetadata$|auth0Admin$|cameraFrames$|cameraLineDetection$|cancellationNotifications$|db$|delayNotifications$|demandCalendar$|demandEvents(?:\/|$)|errors$|fareCache$|fares$|firebase$|forecast(?:$|\/)|forecastDaypart$|forecastRegressionThresholds$|holidays$|leaderboardFlags$|leaderboardPrivacy$|leaderboardSeo$|leaderboards$|logging$|noaaCoastline$|ota$|push$|pushSubscriptions$|safeScheduledJob$|sailingLifecycleNotifications$|serverRuntime$|tides(?:\/|$)|time$|weather(?:\/|$)|wsf(?:\/|$)))(.+)$/,
        replacement: path.resolve(__dirname, "client/lib/$1"),
      },
      { find: "~", replacement: path.resolve(__dirname, "server") },
      { find: "shared", replacement: path.resolve(__dirname, "shared") },
    ],
  },
  test: {
    coverage: {
      include: ["shared/lib/**/*.ts", "server/lib/api.ts"],
      provider: "v8",
      reporter: ["text", "lcov"],
    },
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
