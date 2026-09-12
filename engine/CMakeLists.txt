include(cmake/Warnings.cmake)
include(cmake/Deps.cmake)
add_subdirectory(vendor/vital)

file(GLOB_RECURSE PG_CORE_SOURCES CONFIGURE_DEPENDS
  src/core/*.cpp src/services/*.cpp src/render/*.cpp src/modules/*.cpp
  src/dsp/*.cpp src/pattern/*.cpp src/protocol/*.cpp src/platform/*.cpp src/vital/*.cpp
  src/sst/*.cpp)

add_library(pg_core STATIC ${PG_CORE_SOURCES})
target_include_directories(pg_core PUBLIC src)
target_link_libraries(pg_core PUBLIC vital_dsp sst_headers readerwriterqueue nlohmann_json::nlohmann_json miniaudio_headers)
pg_apply_warnings(pg_core)
set_source_files_properties(src/services/MiniaudioImpl.cpp PROPERTIES COMPILE_OPTIONS "-w")
if(APPLE)
  target_link_libraries(pg_core PUBLIC "-framework CoreAudio" "-framework CoreFoundation" "-framework AudioToolbox")
endif()

add_executable(phasegrid-engine src/app/main.cpp)
target_link_libraries(phasegrid-engine PRIVATE pg_core)
pg_apply_warnings(phasegrid-engine)

# Runs an sst effect outside the engine, so "is the adapter wrong or is this what the effect does?"
# is one command rather than an argument. See the header of the source.
add_executable(pg-sst-ref tools/SstReference.cpp)
target_link_libraries(pg-sst-ref PRIVATE pg_core)
pg_apply_warnings(pg-sst-ref)

if(PG_BUILD_TESTS)
  file(GLOB_RECURSE PG_TEST_SOURCES CONFIGURE_DEPENDS tests/*.cpp)
  add_executable(pg_tests ${PG_TEST_SOURCES})
  target_include_directories(pg_tests PRIVATE tests)
  target_compile_definitions(pg_tests PRIVATE PG_TEST_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests")
  target_link_libraries(pg_tests PRIVATE pg_core Catch2::Catch2WithMain)
  pg_apply_warnings(pg_tests)
  if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    target_compile_options(pg_tests PRIVATE -fno-assume-sane-operator-new)   # never elide calls to our replaced operator new
  endif()
  include(Catch)
  catch_discover_tests(pg_tests)
endif()
