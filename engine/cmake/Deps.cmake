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
