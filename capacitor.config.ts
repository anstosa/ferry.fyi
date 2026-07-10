import { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "fyi.ferry",
  appName: "Ferry FYI",
  webDir: "dist/client",
  bundledWebRuntime: false,
  backgroundColor: "#016f52",
  plugins: {
    CapacitorUpdater: {
      // retain manual update control
      autoUpdate: false,
      // permit staged manifest configuration
      allowModifyUrl: true,
    },
  },
};

export default config;
