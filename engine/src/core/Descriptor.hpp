#pragma once
#include <cstddef>
#include <cstdint>

namespace pg {

inline constexpr uint32_t kModuleAbiVersion = 2;

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
/// The module's telemetry slot carries a `Scope` window of the signal it is fed. An interface gives such
/// a module a scope panel on its face (`scope` in the face rows) and draws the window there. Implies
/// `kModuleWritesTelemetry`; the registry refuses one without the other.
inline constexpr uint32_t kModulePublishesScope = 1u << 4;
/// The module's telemetry slot carries a `Value` reading: the last frame of the signal it is fed, per
/// channel. An interface gives such a module a readout on its face (`value` in the face rows). Implies
/// `kModuleWritesTelemetry`, like the scope.
inline constexpr uint32_t kModulePublishesValue = 1u << 5;
/// The module's telemetry slot carries a `Meter` reading: held peak, RMS and a clip flag per channel.
/// An interface gives such a module a level meter on its face (`meter` in the face rows). Implies
/// `kModuleWritesTelemetry`, like the scope and the readout.
inline constexpr uint32_t kModulePublishesMeter = 1u << 6;

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

/// Widest a face may be, in cells, and the most rows it may have.
inline constexpr uint32_t kMaxFaceCols = 32;
inline constexpr uint32_t kMaxFaceRows = 32;

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
  /**
   * The module's face: what an interface draws on it, as a grid of cells.
   *
   * A module is not a title with a list of ports. On the canvas it is a rectangle of uniform cells,
   * and its face is a composition of blocks -- a jack, a knob, a wave panel -- each covering a whole
   * number of them, the way a hardware panel is a grid of tiles. Which blocks and where is the
   * module's own knowledge, so it is declared here, next to the ports and params it draws, and
   * published with them; the interface composes the face from these rows and adds nothing but a
   * title bar above it.
   *
   * One string per row, whitespace-separated tokens, one token per cell. Equal neighbouring tokens
   * form one rectangular block, exactly as CSS `grid-template-areas`:
   *
   *   "reset wave wave wave fold fold out"
   *   "phase wave wave wave fold fold .  "
   *   "pitch .    .    .    .    .    .  "
   *
   * Tokens: `.` is an empty cell; a port id is a jack for that input or output (`in:<id>` or
   * `out:<id>` when the two sides share a name); a param id is a control for that param (`param:<id>`
   * when it collides with a port id), at least two cells by two; `wave` is the wave panel, at least
   * two by two, on a module that `kModulePreviewsWave`; `scope` is the scope panel, at least two by
   * two, on a module that `kModulePublishesScope`; `value` is the readout, at least two cells by one,
   * on a module that `kModulePublishesValue`; `meter` is the level meter, at least two by two, on a
   * module that `kModulePublishesMeter`. Every declared port appears exactly once.
   * Implicit modulation ports never appear: they ride on their param's control. A short row is
   * padded with `.`. `Registry::add` rejects anything else, so a face that is wrong is a module
   * that does not register rather than a node drawn wrong.
   *
   * Null, with `faceRows` 0, is a module with no declared face; the interface composes one by rule
   * from the ports and the `kParamPrimary` params. Appended after `create` so a descriptor written
   * against the previous layout still initialises: the trailing members are value-initialised.
   */
  const char* const* face;
  uint32_t faceRows;
};

template <class T, size_t N>
constexpr uint32_t countOf(const T (&)[N]) { return static_cast<uint32_t>(N); }

}  // namespace pg
