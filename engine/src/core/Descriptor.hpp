#pragma once
#include <cstddef>
#include <cstdint>

namespace pg {

inline constexpr uint32_t kModuleAbiVersion = 1;

enum class PortKind : uint8_t { Continuous = 0, Event = 1 };
/// UI coloring hint only; the compiler accepts any output into any input.
/// `Note` is a role on an Event port (a stream carrying pitch and velocity); an Event port that carries
/// bare triggers stays `Gate`, so the two read differently in the editor. Append new roles at the end:
/// the value crosses the descriptor ABI.
enum class SignalRole : uint8_t { Any = 0, Audio, Cv, Gate, Pitch, Phase, Note };
enum class ParamUnit : uint8_t { None = 0, Hz, Seconds, Db, Semitones, Percent, Ratio };
enum class ParamCurve : uint8_t { Linear = 0, Log, Exp };

inline constexpr uint32_t kParamModulatable = 1u << 0;
inline constexpr uint32_t kParamInteger     = 1u << 1;
inline constexpr uint32_t kParamEnum        = 1u << 2;
inline constexpr uint32_t kParamHidden      = 1u << 3;
inline constexpr uint32_t kParamNoSmooth    = 1u << 4;
/// Changing this param cannot be done on a live instance: `InstanceTable::acquire` builds a new one.
/// Implies kParamNoSmooth in spirit and may never be kParamModulatable (Registry::add rejects that).
inline constexpr uint32_t kParamStructural  = 1u << 5;
/**
 * A control that belongs on the module's face.
 *
 * A patching interface draws a module the size of a business card and a wavetable oscillator has
 * twenty-odd parameters, so it can only show a few. Which few is the module's own knowledge, not the
 * interface's: the interface has no way to tell that a filter's cutoff matters more than its formant
 * spread. So each module says, and an interface that shows none of them is free to ignore it.
 *
 * Ordinary parameters are not lesser; they are simply reached through the inspector rather than by
 * being always on screen.
 */
inline constexpr uint32_t kParamPrimary    = 1u << 6;

inline constexpr uint32_t kModuleTerminal        = 1u << 0;
inline constexpr uint32_t kModuleNeedsTransport  = 1u << 1;
inline constexpr uint32_t kModuleWritesTelemetry = 1u << 2;
/// The module can draw one cycle of what it would sound like at given param values: `Module::preview`.
/// An interface gives such a module a wave panel on its face and asks the engine what to put in it.
inline constexpr uint32_t kModulePreviewsWave   = 1u << 3;

// C-layout so descriptors can cross a dlopen boundary unchanged.
struct PortDesc {
  const char* id;
  const char* name;
  PortKind kind;
  uint8_t channels;     // ABI slot; always 1 for Continuous (signals are poly_float), 0 for Event
  SignalRole role;      // UI coloring hint only
  const char* doc;
};

struct ParamDesc {
  const char* id;
  const char* name;
  float min, max, def;  // display units
  ParamUnit unit;
  ParamCurve curve;
  uint32_t flags;
  const char* const* enumLabels;
  uint32_t enumCount;
  const char* uiWidget;   // "slider" | "knob" | "toggle" | "select"
  const char* group;
  const char* doc;
};

class Module;

struct ModuleDescriptor {
  uint32_t abiVersion;
  const char* id;          // "osc.wavetable"
  const char* name;
  const char* category;
  const char* doc;
  const PortDesc* inputs;  uint32_t numInputs;
  const PortDesc* outputs; uint32_t numOutputs;
  const ParamDesc* params; uint32_t numParams;
  uint32_t flags;
  uint32_t telemetrySlots;
  Module* (*create)();
};

template <class T, size_t N>
constexpr uint32_t countOf(const T (&)[N]) { return static_cast<uint32_t>(N); }

}  // namespace pg
