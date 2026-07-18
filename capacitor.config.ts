import { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "fyi.ferry",
  appName: "Ferry FYI",
  webDir: "dist/client",
  bundledWebRuntime: false,
  backgroundColor: "#016f52",
  ios: {
    scheme: "Ferry FYI",
  },
  plugins: {
    CapacitorHttp: {
      // Auth0's token endpoint does not allow the default iOS WebView origin.
      // Route native fetch requests through URLSession instead of CORS.
      enabled: true,
    },
    CapacitorUpdater: {
      // retain manual update control
      autoUpdate: false,
      // permit staged manifest configuration
      allowModifyUrl: true,
    },
  },
};

export default config;
