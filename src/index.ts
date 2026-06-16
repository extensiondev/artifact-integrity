import pkg from "../package.json";
export const version: string = pkg.version as string;

export { runArtifacts } from "./runner";
export type { RunArtifactsInput, RunArtifactsResult } from "./types";
