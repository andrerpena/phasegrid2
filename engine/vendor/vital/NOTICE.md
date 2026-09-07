# Vendored Vital DSP

Source: https://github.com/mtytel/vital, commit 636ca0ef517a4db087a6a08a6a8a5e704e21f836 (2022-04-20).
Copyright 2013-2019 Matt Tytel. License: GNU General Public License v3.0 or later (see LICENSE here).
phasegrid2 is AGPL-3.0-only; GPLv3 section 13 permits this combination.

Only the DSP engine is vendored (src/synthesis minus the voice handler and aggregate modules, the wavetable
authoring layer, parameters, line generator, FFT wrapper) plus kissfft (BSD-3-Clause). No UI, plugin, standalone,
authentication or Firebase code. `scripts/vendor-vital.mjs` reproduces the copy.

Trademark: the names "Vital", "Vital Audio", "Tytel" and "Matt Tytel" are not used for phasegrid2 module ids,
UI strings, binaries or marketing. Vital's presets and factory wavetables are not redistributed.

JUCE is replaced by `shim/JuceHeader.h` (leak-detector macros as no-ops; minimal String, MemoryOutputStream,
Base64; ProjectInfo), `shim/json/json.h` (nlohmann/json), `shim/load_save.h` (three static helpers) and
`shim/voice_handler.h` (constants only). `synth_strings.h` is copied from src/interface/look_and_feel.

Modified vendored files: Vital's own build concatenates translation units into a handful of unity-build
files (see `src/unity_build/*.cpp` in the upstream tree), so several headers there compile only because an
earlier file in the same unity TU already pulled in a transitive dependency. Compiling one file per
translation unit (this CMake target) exposes those implicit orderings as missing includes. Each fix below
only adds an `#include` for a type/function the file already used; no logic changed.

- `src/common/wavetable/wave_line_source.h`: added `#include "line_generator.h"` (uses `LineGenerator`).
- `src/common/synth_strings.h`: added `#include "operators.h"` (uses `vital::StereoEncoder::kNumStereoModes`).
- `src/synthesis/filters/phaser_filter.h`: added `#include "futils.h"` (uses `futils::midiOffsetToRatio`).
- `src/synthesis/modules/envelope_module.h`: replaced the forward declaration of `vital::Envelope` with
  `#include "envelope.h"` (an inline method dereferences `envelope_`, which needs the complete type).
- `src/synthesis/modules/equalizer_module.h`: added `#include "memory.h"` (uses `vital::StereoMemory`).
- `src/synthesis/modulators/synth_lfo.cpp`: added `#include "futils.h"` (uses `futils::exp2`).
- `src/synthesis/effects/reverb.h`: replaced the forward declaration of `vital::StereoMemory` with
  `#include "memory.h"` (the inline `~Reverb()` destructor needs the complete type for `std::unique_ptr`).

Re-running `scripts/vendor-vital.mjs` overwrites these seven files with the unmodified upstream source;
reapply the includes above (or extend the script) before rebuilding after a re-vendor.
