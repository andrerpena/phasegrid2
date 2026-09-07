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

class Registry {
public:
  std::optional<std::string> add(const ModuleDescriptor& desc);   // error message on rejection
  const RegisteredModule* find(std::string_view typeId) const;
  std::vector<const RegisteredModule*> all() const;
private:
  std::map<std::string, std::unique_ptr<RegisteredModule>, std::less<>> byId_;
};

}  // namespace pg
