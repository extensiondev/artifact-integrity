import type { UserConfig } from "vitest/config";

const config: UserConfig = {
  test: {
    environment: "node",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
};

export default config;
