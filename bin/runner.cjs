#!/usr/bin/env node
// ██╗███╗   ██╗████████╗███████╗ ██████╗ ██████╗ ██╗████████╗██╗   ██╗
// ██║████╗  ██║╚══██╔══╝██╔════╝██╔════╝ ██╔══██╗██║╚══██╔══╝╚██╗ ██╔╝
// ██║██╔██╗ ██║   ██║   █████╗  ██║  ███╗██████╔╝██║   ██║    ╚████╔╝
// ██║██║╚██╗██║   ██║   ██╔══╝  ██║   ██║██╔══██╗██║   ██║     ╚██╔╝
// ██║██║ ╚████║   ██║   ███████╗╚██████╔╝██║  ██║██║   ██║      ██║
// ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝   ╚═╝      ╚═╝
// Apache License 2.0 (c) 2026 Cezar Augusto and the extension.dev collaborators

const fs = require("node:fs");
const path = require("node:path");

const _c =
  !("NO_COLOR" in process.env) &&
  (process.stderr.isTTY || "FORCE_COLOR" in process.env);
const _w = (o, c) => (t) => (_c ? `\x1b[${o}m${t}\x1b[${c}m` : t);
const _green = _w(32, 39);
const _red = _w(31, 39);
const _blue = _w(34, 39);

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base-url") out.baseUrl = argv[++i];
    else if (a === "--owner") out.owner = argv[++i];
    else if (a === "--repo") out.repo = argv[++i];
    else if (a === "--sha") out.sha = argv[++i];
    else if (a === "--browser") out.browser = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--timeout-ms") out.timeoutMs = Number(argv[++i]);
    else if (a === "--token") out.token = argv[++i];
    else if (a === "--expected-sha256") out.expectedSha256 = argv[++i];
    else if (a === "--require-digest") out.requireDigest = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl =
    args.baseUrl ||
    process.env.EXTENSIONDEV_ARTIFACTS_BASE_URL ||
    "https://registry.extension.land";

  for (const k of ["owner", "repo", "sha", "browser"]) {
    if (!args[k]) {
      throw new Error(
        `Missing required flag: --${k}\nNext step: pass --${k} or set the corresponding value in your run configuration.`,
      );
    }
  }

  const outFile =
    args.out || path.resolve(process.cwd(), "artifact-integrity.json");
  const { runArtifacts } = require("../dist/module.js");

  const token = args.token || process.env.EXTENSION_DEV_TOKEN || undefined;
  const expectedSha256 =
    args.expectedSha256 ||
    process.env.EXTENSIONDEV_EXPECTED_SHA256 ||
    undefined;

  const requireDigest =
    Boolean(args.requireDigest) ||
    process.env.EXTENSIONDEV_REQUIRE_DIGEST === "1";

  const result = await runArtifacts({
    artifactsBaseUrl: baseUrl,
    owner: args.owner,
    repo: args.repo,
    sha: args.sha,
    browser: args.browser,
    timeoutMs: args.timeoutMs,
    token,
    expectedSha256,
    requireDigest,
  });

  fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(`${_green("⏵⏵⏵")} ${_blue("integrity")} Wrote ${outFile}`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(
    `${_red("ERROR")} ${_blue("integrity")} ${err?.message || String(err)}`,
  );
  process.exit(1);
});
