# The SST libraries

Audio DSP from the Surge Synth Team, used for the effects rack. Unlike `engine/vendor/vital`, these
are **not copied into this repository**: they are fetched at configure time by
`engine/cmake/Deps.cmake`, pinned to exact commits, because we do not modify them and a pinned commit
is a complete and precise reference to the source. This file is here because that reference, and the
licence it carries, has to live somewhere a reader will find it.

| Library | Commit | Licence | Source |
|---|---|---|---|
| sst-effects | `adcac6950292dacc529651093e7ece2d1c8c0d4b` | GPL-3.0-or-later | https://github.com/surge-synthesizer/sst-effects |
| sst-basic-blocks | `3ee58b0dbd8f38ba0693a091d758da25a643cc6c` | GPL-3.0-or-later (three headers also MIT) | https://github.com/surge-synthesizer/sst-basic-blocks |
| sst-filters | `e92d93a92beabde03fa4ab767b285fa21c6608d6` | GPL-3.0-or-later | https://github.com/surge-synthesizer/sst-filters |
| sst-waveshapers | `dd12f31a5a9016c9895e52d1a00eee0e1eebe6ce` | GPL-3.0-or-later | https://github.com/surge-synthesizer/sst-waveshapers |
| fmt | `e424e3f2e607da02742f73db84873b8084fc714c` (12.0.0) | MIT | https://github.com/fmtlib/fmt |
| simde | `71fd833d9666141edcd1d3c109a80e228303d8d7` | MIT | https://github.com/simd-everywhere/simde |

Those are the commits Surge XT itself pins, read from `git submodule status libs/` in a Surge
checkout. Moving one means moving it here and re-running `npm run engine:test` and
`npm run module:probe -- --all`.

phasegrid2 is AGPL-3.0-only; GPL-3.0 section 13 permits this combination, the same way it does for
the vendored Vital DSP next door.

**fmt** is a dependency of `sst/basic-blocks/params/ParamMetadata.h`, used header-only
(`FMT_HEADER_ONLY=1`), so nothing links against it.

**simde is not optional.** The sst libraries are hand-coded SSE2 and this project builds arm64;
`sst/basic-blocks/simd/setup.h` includes `<simde/x86/sse4.2.h>` and maps `SIMD_MM(x)` onto
`simde_mm_##x` off x86. Without it nothing in `engine/src/sst` compiles on Apple Silicon.

No source here is modified. `engine/src/sst` is phasegrid's own adapter, written against the
`FXConfig` contract documented in `sst/effects/EffectCore.h`; `sst/effects/ConcreteConfig.h` is the
library's own minimal implementation of the same contract and is worth reading beside it.

Trademark: "Surge", "Surge XT" and "Surge Synth Team" are not used for phasegrid2 module ids, UI
strings, binaries or marketing.
