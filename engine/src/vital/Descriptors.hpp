#pragma once
#include "core/Descriptor.hpp"
#include "vital/Spec.hpp"

namespace pg::vendor {

/// Builds the ModuleDescriptor for a spec by instantiating the vendored module once, reading its controls and
/// the vendored parameter table, and generating one ParamDesc per exposed control. Everything the descriptor
/// points at is heap storage that is never freed: a descriptor lives for the life of the process, and the
/// Registry, every Program and every compiled patch hold raw pointers into it.
///
/// Call once per module type (a `static const ModuleDescriptor&` in the module's accessor). Message thread
/// only. Throws std::runtime_error when the spec does not match the vendored module.
const ModuleDescriptor& buildDescriptor(const ModuleSpec& spec);

/// The spec a generated descriptor was built from. Used by the adapter to configure itself at create time.
const ModuleSpec& specFor(const ModuleDescriptor& desc);

}  // namespace pg::vendor
