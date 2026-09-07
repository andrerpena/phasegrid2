cmake_minimum_required(VERSION 3.28)
project(phasegrid2 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo CACHE STRING "" FORCE)
endif()

option(PG_BUILD_TESTS "Build engine tests" ON)
# OFF by default on purpose: `postinstall` builds this engine from source on end-user machines,
# so a warning from a future compiler must never turn `npm install` into a hard failure.
# CI and the dev preset turn it ON, which is where warning regressions get caught.
option(PG_WERROR "Treat compiler warnings as errors" OFF)

enable_testing()
add_subdirectory(engine)
