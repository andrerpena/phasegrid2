include(FetchContent)
set(FETCHCONTENT_QUIET OFF)

FetchContent_Declare(readerwriterqueue
  GIT_REPOSITORY https://github.com/cameron314/readerwriterqueue.git GIT_TAG v1.0.7 GIT_SHALLOW TRUE)
FetchContent_Declare(nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git GIT_TAG v3.12.0 GIT_SHALLOW TRUE)
# SOURCE_SUBDIR points at a directory that does not exist so miniaudio's own CMakeLists is not added.
FetchContent_Declare(miniaudio
  GIT_REPOSITORY https://github.com/mackron/miniaudio.git GIT_TAG 0.11.25 GIT_SHALLOW TRUE
  SOURCE_SUBDIR cmake_disabled)
FetchContent_Declare(Catch2
  GIT_REPOSITORY https://github.com/catchorg/Catch2.git GIT_TAG v3.16.0 GIT_SHALLOW TRUE)

set(JSON_BuildTests OFF CACHE INTERNAL "")
FetchContent_MakeAvailable(readerwriterqueue nlohmann_json miniaudio)

add_library(miniaudio_headers INTERFACE)
target_include_directories(miniaudio_headers INTERFACE ${miniaudio_SOURCE_DIR})

if(PG_BUILD_TESTS)
  FetchContent_MakeAvailable(Catch2)
  list(APPEND CMAKE_MODULE_PATH ${catch2_SOURCE_DIR}/extras)
  set(CMAKE_MODULE_PATH ${CMAKE_MODULE_PATH} PARENT_SCOPE)
endif()

# --- The SST libraries (Surge Synth Team) -------------------------------------------------------
# Header-only DSP, pinned to the commits Surge itself pins (`git submodule status libs/` in a Surge
# checkout). GPL-3.0-or-later into this AGPL-3.0 project, the same combination `engine/vendor/vital`
# already relies on under GPL section 13; see engine/vendor/sst/NOTICE.md.
#
# These are FETCHED rather than vendored, unlike Vital: we do not modify them, so a pinned commit is
# a complete and precise reference to the source, and the trees are large (simde alone is 70 MB).
FetchContent_Declare(sst_basic_blocks
  GIT_REPOSITORY https://github.com/surge-synthesizer/sst-basic-blocks.git
  GIT_TAG 3ee58b0dbd8f38ba0693a091d758da25a643cc6c
  GIT_SHALLOW FALSE SOURCE_SUBDIR cmake_disabled)
FetchContent_Declare(sst_effects
  GIT_REPOSITORY https://github.com/surge-synthesizer/sst-effects.git
  GIT_TAG adcac6950292dacc529651093e7ece2d1c8c0d4b
  GIT_SHALLOW FALSE SOURCE_SUBDIR cmake_disabled)
FetchContent_Declare(sst_filters
  GIT_REPOSITORY https://github.com/surge-synthesizer/sst-filters.git
  GIT_TAG e92d93a92beabde03fa4ab767b285fa21c6608d6
  GIT_SHALLOW FALSE SOURCE_SUBDIR cmake_disabled)
FetchContent_Declare(sst_waveshapers
  GIT_REPOSITORY https://github.com/surge-synthesizer/sst-waveshapers.git
  GIT_TAG dd12f31a5a9016c9895e52d1a00eee0e1eebe6ce
  GIT_SHALLOW FALSE SOURCE_SUBDIR cmake_disabled)
# `sst/basic-blocks/params/ParamMetadata.h` includes <fmt/core.h>; header-only mode keeps it a
# include-path dependency rather than a library to link.
FetchContent_Declare(fmt
  GIT_REPOSITORY https://github.com/fmtlib/fmt.git
  GIT_TAG e424e3f2e607da02742f73db84873b8084fc714c
  GIT_SHALLOW FALSE SOURCE_SUBDIR cmake_disabled)
# sst is hand-coded SSE2. simde carries it to arm64, which is the only reason this builds on Apple
# Silicon: `sst/basic-blocks/simd/setup.h` includes <simde/x86/sse4.2.h> off x86. MIT.
FetchContent_Declare(simde
  GIT_REPOSITORY https://github.com/simd-everywhere/simde.git
  GIT_TAG 71fd833d9666141edcd1d3c109a80e228303d8d7
  GIT_SHALLOW FALSE SOURCE_SUBDIR cmake_disabled)

# `SOURCE_SUBDIR cmake_disabled` on each declaration above points at a directory that does not
# exist, so these are populated without adding their own CMakeLists -- we want the include paths,
# not their targets, their tests or their install rules. Same trick as miniaudio above.
FetchContent_MakeAvailable(sst_basic_blocks sst_effects sst_filters sst_waveshapers fmt simde)

add_library(sst_headers INTERFACE)
target_include_directories(sst_headers SYSTEM INTERFACE
  ${sst_effects_SOURCE_DIR}/include
  ${sst_basic_blocks_SOURCE_DIR}/include
  ${sst_filters_SOURCE_DIR}/include
  ${sst_waveshapers_SOURCE_DIR}/include
  ${fmt_SOURCE_DIR}/include
  ${simde_SOURCE_DIR})
target_compile_definitions(sst_headers INTERFACE FMT_HEADER_ONLY=1)
