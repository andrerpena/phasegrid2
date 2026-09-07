include(cmake/Warnings.cmake)
include(cmake/Deps.cmake)

file(GLOB_RECURSE PG_CORE_SOURCES CONFIGURE_DEPENDS
  src/core/*.cpp src/services/*.cpp src/render/*.cpp src/modules/*.cpp
  src/dsp/*.cpp src/protocol/*.cpp src/platform/*.cpp)

add_library(pg_core STATIC ${PG_CORE_SOURCES})
target_include_directories(pg_core PUBLIC src)
target_link_libraries(pg_core PUBLIC readerwriterqueue nlohmann_json::nlohmann_json miniaudio_headers)
pg_apply_warnings(pg_core)
if(APPLE)
  target_link_libraries(pg_core PUBLIC "-framework CoreAudio" "-framework CoreFoundation" "-framework AudioToolbox")
endif()

add_executable(phasegrid-engine src/app/main.cpp)
target_link_libraries(phasegrid-engine PRIVATE pg_core)
pg_apply_warnings(phasegrid-engine)

if(PG_BUILD_TESTS)
  file(GLOB_RECURSE PG_TEST_SOURCES CONFIGURE_DEPENDS tests/*.cpp)
  add_executable(pg_tests ${PG_TEST_SOURCES})
  target_include_directories(pg_tests PRIVATE tests)
  target_compile_definitions(pg_tests PRIVATE PG_TEST_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests")
  target_link_libraries(pg_tests PRIVATE pg_core Catch2::Catch2WithMain)
  include(Catch)
  catch_discover_tests(pg_tests)
endif()
