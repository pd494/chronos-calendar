import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "ChronosCalendar",
    identifier: "com.chronos.calendar",
    version: "0.1.0",
    urlSchemes: ["chronoscalendar", "chronosbun"],
  },
  build: {
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
