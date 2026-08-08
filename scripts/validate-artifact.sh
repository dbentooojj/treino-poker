#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

worker="${SITES_PROJECT_ROOT}/dist/server/index.js"
hosting="${SITES_PROJECT_ROOT}/dist/.openai/hosting.json"
cloudflare_loader="${SITES_PROJECT_ROOT}/tests/cloudflare-loader.mjs"

[[ -f "${worker}" ]] || {
  echo "Missing Sites Worker entry: dist/server/index.js" >&2
  exit 66
}
[[ -f "${hosting}" ]] || {
  echo "Missing packaged Sites manifest: dist/.openai/hosting.json" >&2
  exit 66
}
[[ -f "${cloudflare_loader}" ]] || {
  echo "Missing local Cloudflare module loader: tests/cloudflare-loader.mjs" >&2
  exit 66
}

node --input-type=module - "${worker}" "${hosting}" "${cloudflare_loader}" <<'NODE'
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const [workerPath, hostingPath, cloudflareLoaderPath] = process.argv.slice(2);
JSON.parse(await readFile(hostingPath, "utf8"));
register(pathToFileURL(cloudflareLoaderPath));

const workerUrl = pathToFileURL(workerPath);
workerUrl.searchParams.set("sites-validation", `${process.pid}-${Date.now()}`);
const worker = await import(workerUrl.href);
if (!worker.default || typeof worker.default.fetch !== "function") {
  throw new Error("dist/server/index.js must have an ESM default export with fetch(request, env, ctx)");
}
NODE

echo "Validated Sites artifact: ESM Worker default.fetch and hosting manifest are present."
