// Loads pg_telemetry.node from wherever the build put it.
//
// `.cjs`, not `.js`: the package is `"type": "module"`, so a `.js` file here would be parsed as ESM and
// `require`/`module.exports` would not mean what they say. A native addon can only be loaded through
// `require`, so this module is explicitly CommonJS.
//
// Kept as one module so the preload, a test and a script all resolve the addon the same way. A missing
// addon is reported as a clear error rather than a module-not-found, because the usual cause is a fresh
// checkout where `npm install` has not built it yet.

const { existsSync } = require("node:fs");
const { join, resolve } = require("node:path");

const CANDIDATES = [
  process.env.PHASEGRID_TELEMETRY_ADDON,
  resolve(__dirname, "../build/native/pg_telemetry.node"),
  join(process.resourcesPath ?? "", "native", "pg_telemetry.node"),
].filter(Boolean);

let cached = null;

function load() {
  if (cached !== null) return cached;
  for (const path of CANDIDATES) {
    if (!existsSync(path)) continue;
    cached = require(path);
    return cached;
  }
  throw new Error(
    `pg_telemetry.node not found (looked in ${CANDIDATES.join(", ")}). ` +
      "Run `npm run engine:build`, or set PHASEGRID_TELEMETRY_ADDON.",
  );
}

module.exports = {
  load,
  /** Maps a segment read-only. Throws if it does not exist, which is the normal case before the engine starts. */
  open(name, byteLength) {
    return new (load().Segment)(name, byteLength);
  },
};
