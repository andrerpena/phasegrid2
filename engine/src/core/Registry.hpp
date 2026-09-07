#pragma once
#include <list>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>
#include "core/Descriptor.hpp"

namespace pg {

struct RegisteredModule {
  const ModuleDescriptor* desc = nullptr;
  std::vector<PortDesc> inputs;        // declared inputs, then one implicit port per modulatable param
  std::vector<int32_t> inputParam;     // per input: param index for implicit ports, else -1
  std::list<std::string> implicitIds;  // stable storage for "param:<id>" strings

  uint32_t numDeclaredInputs() const { return desc->numInputs; }
  int32_t findInput(std::string_view id) const;
  int32_t findOutput(std::string_view id) const;
  int32_t findParam(std::string_view id) const;
};

/// The descriptor whose `create()` is running right now, or nullptr. `ModuleDescriptor::create` is a plain
/// C function pointer taking no argument (so descriptors can cross a future dlopen boundary unchanged), which
/// leaves a module type that is *generated* rather than hand-written with no way to know which of its many
/// generated descriptors it is being built for. `InstanceTable::acquire` publishes it here for the duration of
/// the call and clears it afterwards; message thread only, hence thread_local rather than a lock.
extern thread_local const ModuleDescriptor* g_creatingDescriptor;

/// Sets `g_creatingDescriptor` for the lifetime of the scope, restoring whatever was there before.
class CreatingDescriptorScope {
public:
  explicit CreatingDescriptorScope(const ModuleDescriptor* d) : previous_(g_creatingDescriptor) { g_creatingDescriptor = d; }
  ~CreatingDescriptorScope() { g_creatingDescriptor = previous_; }
  CreatingDescriptorScope(const CreatingDescriptorScope&) = delete;
  CreatingDescriptorScope& operator=(const CreatingDescriptorScope&) = delete;
private:
  const ModuleDescriptor* previous_;
};

class Registry {
public:
  std::optional<std::string> add(const ModuleDescriptor& desc);   // error message on rejection
  const RegisteredModule* find(std::string_view typeId) const;
  std::vector<const RegisteredModule*> all() const;
private:
  std::map<std::string, std::unique_ptr<RegisteredModule>, std::less<>> byId_;
};

}  // namespace pg
