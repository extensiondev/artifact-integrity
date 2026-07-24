import type { UserConfig } from "vitest/config";

const config: UserConfig = {
  test: {
    environment: "node",
    pool: "forks",
  },
};

export default config;
