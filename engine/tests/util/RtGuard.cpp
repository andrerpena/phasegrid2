#include "util/RtGuard.hpp"
#include <atomic>
#include <cstdlib>
#include <new>

namespace {
thread_local int g_depth = 0;
std::atomic<uint64_t> g_violations{0};
void note() { if (g_depth > 0) g_violations.fetch_add(1, std::memory_order_relaxed); }
}  // namespace

namespace pg::test {
RtScope::RtScope() { ++g_depth; }
RtScope::~RtScope() { --g_depth; }
uint64_t rtViolations() { return g_violations.load(); }
void resetRtViolations() { g_violations.store(0); }
}  // namespace pg::test

void* operator new(std::size_t n) { note(); if (void* p = std::malloc(n ? n : 1)) return p; throw std::bad_alloc(); }
void* operator new[](std::size_t n) { note(); if (void* p = std::malloc(n ? n : 1)) return p; throw std::bad_alloc(); }
void operator delete(void* p) noexcept { note(); std::free(p); }
void operator delete[](void* p) noexcept { note(); std::free(p); }
void operator delete(void* p, std::size_t) noexcept { note(); std::free(p); }
void operator delete[](void* p, std::size_t) noexcept { note(); std::free(p); }
