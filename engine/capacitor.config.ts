import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "os.joe.now",
  appName: "Joe OS Now",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
