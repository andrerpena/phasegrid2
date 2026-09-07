#pragma once
#include <string>
namespace pg {
struct Result {
  bool ok = true;
  std::string code;
  std::string message;
  static Result fail(std::string c, std::string m) { return Result{false, std::move(c), std::move(m)}; }
  explicit operator bool() const { return ok; }
};
}  // namespace pg
