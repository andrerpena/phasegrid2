// pg_telemetry: read-only access to the engine's shared-memory telemetry segment.
//
// The engine writes fixed-size slots into a POSIX shared memory segment from its audio thread. This
// addon maps that segment read-only and copies slots out of it, so the renderer can watch a meter or a
// scope without an IPC round trip per frame.
//
// Node-API rather than V8 directly: the ABI is stable across Node and Electron versions, which is what
// lets one build serve both without recompiling per Electron release.

#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <string>

#include <napi.h>

namespace {

/// One mapped segment. Read-only: this process never writes to memory the engine owns.
class Segment : public Napi::ObjectWrap<Segment> {
public:
  static Napi::Function init(Napi::Env env) {
    return DefineClass(env, "Segment",
                       {
                           InstanceMethod("read", &Segment::read),
                           InstanceMethod("close", &Segment::close),
                           InstanceAccessor("byteLength", &Segment::byteLength, nullptr),
                       });
  }

  explicit Segment(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Segment>(info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
      Napi::TypeError::New(env, "open(name, byteLength)").ThrowAsJavaScriptException();
      return;
    }
    const std::string name = info[0].As<Napi::String>();
    const size_t bytes = static_cast<size_t>(info[1].As<Napi::Number>().Int64Value());

    const int fd = shm_open(name.c_str(), O_RDONLY, 0);
    if (fd < 0) {
      Napi::Error::New(env, "shm_open " + name + ": " + std::strerror(errno))
          .ThrowAsJavaScriptException();
      return;
    }
    void* mapped = mmap(nullptr, bytes, PROT_READ, MAP_SHARED, fd, 0);
    // The mapping keeps the segment alive on its own, so the descriptor is not needed past this point
    // and holding it would leak one per open.
    ::close(fd);
    if (mapped == MAP_FAILED) {
      Napi::Error::New(env, "mmap " + name + ": " + std::strerror(errno))
          .ThrowAsJavaScriptException();
      return;
    }
    base_ = static_cast<const uint8_t*>(mapped);
    bytes_ = bytes;
  }

  ~Segment() override { unmap(); }

private:
  void unmap() {
    if (base_ == nullptr) return;
    munmap(const_cast<uint8_t*>(base_), bytes_);
    base_ = nullptr;
    bytes_ = 0;
  }

  Napi::Value byteLength(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), static_cast<double>(bytes_));
  }

  /**
   * `read(offset, length)` copies `length` bytes into a fresh Buffer.
   *
   * A copy, deliberately, rather than a view onto the mapping: the engine keeps writing, so a view
   * would change under the caller mid-parse, and it would also hand JavaScript a pointer whose lifetime
   * this object controls. Bounds are checked against the mapping every call, because the argument comes
   * from script and an out-of-range offset here would read whatever follows the mapping.
   */
  Napi::Value read(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (base_ == nullptr) {
      Napi::Error::New(env, "segment is closed").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
      Napi::TypeError::New(env, "read(offset, length)").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    const int64_t offset = info[0].As<Napi::Number>().Int64Value();
    const int64_t length = info[1].As<Napi::Number>().Int64Value();
    if (offset < 0 || length < 0 ||
        static_cast<size_t>(offset) + static_cast<size_t>(length) > bytes_) {
      Napi::RangeError::New(env, "read out of range").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    return Napi::Buffer<uint8_t>::Copy(env, base_ + offset, static_cast<size_t>(length));
  }

  Napi::Value close(const Napi::CallbackInfo& info) {
    unmap();
    return info.Env().Undefined();
  }

  const uint8_t* base_ = nullptr;
  size_t bytes_ = 0;
};

Napi::Object initModule(Napi::Env env, Napi::Object exports) {
  exports.Set("Segment", Segment::init(env));
  return exports;
}

}  // namespace

NODE_API_MODULE(pg_telemetry, initModule)
