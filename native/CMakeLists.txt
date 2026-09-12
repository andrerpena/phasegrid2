# pg_telemetry.node -- the renderer's read-only window onto the engine's shared memory.
#
# Built with plain CMake rather than cmake-js so one tree builds the engine and the addon together, and
# so `postinstall` needs nothing but a compiler. Node-API keeps the result ABI-stable across Node and
# Electron versions, so this is built once rather than per Electron release.

find_path(NODE_API_HEADERS_DIR
  NAMES node_api.h
  PATHS "${CMAKE_SOURCE_DIR}/node_modules/node-api-headers/include"
  NO_DEFAULT_PATH)
find_path(NODE_ADDON_API_DIR
  NAMES napi.h
  PATHS "${CMAKE_SOURCE_DIR}/node_modules/node-addon-api"
  NO_DEFAULT_PATH)

if(NOT NODE_API_HEADERS_DIR OR NOT NODE_ADDON_API_DIR)
  message(WARNING
    "node-addon-api / node-api-headers not found under node_modules; skipping pg_telemetry. "
    "Run `npm install` first.")
  return()
endif()

add_library(pg_telemetry SHARED binding.cpp)
target_include_directories(pg_telemetry PRIVATE "${NODE_API_HEADERS_DIR}" "${NODE_ADDON_API_DIR}")
target_compile_features(pg_telemetry PRIVATE cxx_std_20)
# Node-API's C++ wrapper is the one place exceptions earn their keep: it turns a C++ throw into a
# JavaScript one, which is how an addon reports a bad argument without terminating the host process.
target_compile_definitions(pg_telemetry PRIVATE NAPI_CPP_EXCEPTIONS NAPI_VERSION=8)

set_target_properties(pg_telemetry PROPERTIES
  PREFIX ""
  SUFFIX ".node"
  # The host process supplies the Node-API symbols; the addon must not try to resolve them at link time.
  LINK_FLAGS "-undefined dynamic_lookup"
  LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/native")
