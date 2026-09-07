#!/usr/bin/env node
// Copies the curated Vital DSP subset (GPL-3.0-or-later, https://github.com/mtytel/vital, commit 636ca0e)
// into engine/vendor/vital. Run once; the copied files are committed. Re-run to refresh from VITAL_SRC.
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = process.env.VITAL_SRC;
if (!src) {
  console.error(
    "[vendor-vital] VITAL_SRC is not set.\n" +
      "Set it to a checkout of the upstream source tree recorded in engine/vendor/vital/NOTICE.md:\n" +
      "  https://github.com/mtytel/vital, commit 636ca0ef517a4db087a6a08a6a8a5e704e21f836 (2022-04-20)\n" +
      "  git clone https://github.com/mtytel/vital /path/to/src && git -C /path/to/src checkout 636ca0e\n" +
      "  VITAL_SRC=/path/to/src node scripts/vendor-vital.mjs",
  );
  process.exit(1);
}
const dst = join(root, "engine/vendor/vital");

const EXCLUDE_STEMS = new Set([
  "synth_voice_handler",
  "producers_module",
  "filters_module",
  "reorderable_effect_chain",
]);
const FRAMEWORK_KEEP = new Set([
  "common.h",
  "poly_values.h",
  "poly_utils.h",
  "futils.h",
  "utils.h",
  "utils.cpp",
  "matrix.h",
  "circular_queue.h",
  "processor.h",
  "processor.cpp",
  "processor_router.h",
  "processor_router.cpp",
  "value.h",
  "value.cpp",
  "feedback.h",
  "feedback.cpp",
  "operators.h",
  "operators.cpp",
  "synth_module.h",
  "synth_module.cpp",
  "note_handler.h",
]);
const DIRS = [
  "src/synthesis/framework",
  "src/synthesis/filters",
  "src/synthesis/effects",
  "src/synthesis/modulators",
  "src/synthesis/producers",
  "src/synthesis/lookups",
  "src/synthesis/utilities",
  "src/synthesis/modules",
  "src/common/wavetable",
];
const FILES = [
  "src/common/synth_constants.h",
  "src/common/synth_types.h",
  "src/common/synth_types.cpp",
  "src/common/synth_parameters.h",
  "src/common/synth_parameters.cpp",
  "src/common/fourier_transform.h",
  "src/common/line_generator.h",
  "src/common/line_generator.cpp",
  "third_party/kissfft/kissfft.h",
  "third_party/kissfft/COPYING",
  "LICENSE",
];
const RENAMES = {
  "src/interface/look_and_feel/synth_strings.h": "src/common/synth_strings.h",
};

rmSync(join(dst, "src"), { recursive: true, force: true });
rmSync(join(dst, "third_party"), { recursive: true, force: true });
let count = 0;
const copy = (rel, to = rel) => {
  const target = join(dst, to);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(src, rel), target);
  count += 1;
};
for (const dir of DIRS) {
  for (const file of readdirSync(join(src, dir))) {
    if (!/\.(h|cpp)$/.test(file)) continue;
    if (EXCLUDE_STEMS.has(file.replace(/\.(h|cpp)$/, ""))) continue;
    if (dir.endsWith("framework") && !FRAMEWORK_KEEP.has(file)) continue;
    copy(join(dir, file));
  }
}
for (const file of FILES) copy(file);
for (const [from, to] of Object.entries(RENAMES)) copy(from, to);
console.log(
  `[vendor-vital] copied ${count} files from ${src} to engine/vendor/vital`,
);
