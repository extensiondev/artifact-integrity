// ██╗███╗   ██╗████████╗███████╗ ██████╗ ██████╗ ██╗████████╗██╗   ██╗
// ██║████╗  ██║╚══██╔══╝██╔════╝██╔════╝ ██╔══██╗██║╚══██╔══╝╚██╗ ██╔╝
// ██║██╔██╗ ██║   ██║   █████╗  ██║  ███╗██████╔╝██║   ██║    ╚████╔╝
// ██║██║╚██╗██║   ██║   ██╔══╝  ██║   ██║██╔══██╗██║   ██║     ╚██╔╝
// ██║██║ ╚████║   ██║   ███████╗╚██████╔╝██║  ██║██║   ██║      ██║
// ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) Cezar Augusto and the extension.dev collaborators

import * as path from "path";
import { defineConfig } from "@rslib/core";

export default defineConfig({
  source: {
    tsconfigPath: "./tsconfig.build.json",
    entry: {
      module: path.resolve(__dirname, "./module.ts"),
    },
  },
  lib: [
    {
      format: "cjs",
      syntax: "es2021",
      dts: true,
    },
  ],
});
