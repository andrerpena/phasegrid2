file(GLOB_RECURSE VITAL_SOURCES CONFIGURE_DEPENDS src/*.cpp)
add_library(vital_dsp STATIC ${VITAL_SOURCES})
target_compile_features(vital_dsp PUBLIC cxx_std_20)
target_include_directories(vital_dsp PUBLIC shim)
# SYSTEM: the vendored headers are instantiated inside our translation units, and they are not
# ours to fix. Without this, -Wconversion/-Wsign-compare diagnostics from vendored templates would
# be attributed to our sources, and PG_WERROR=ON could not be turned on at all.
target_include_directories(vital_dsp SYSTEM PUBLIC
  src/synthesis/framework src/synthesis/filters src/synthesis/effects src/synthesis/modulators
  src/synthesis/producers src/synthesis/lookups src/synthesis/utilities src/synthesis/modules
  src/common src/common/wavetable third_party)
target_link_libraries(vital_dsp PUBLIC nlohmann_json::nlohmann_json)
target_compile_options(vital_dsp PRIVATE -w)
target_compile_definitions(vital_dsp PUBLIC NO_AUTH=1 $<$<CONFIG:Debug>:DEBUG=1>)
if(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|AMD64")
  target_compile_options(vital_dsp PUBLIC -msse2)
endif()
if(APPLE)
  target_link_libraries(vital_dsp PUBLIC "-framework Accelerate")
endif()
