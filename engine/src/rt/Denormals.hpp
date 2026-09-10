#pragma once
#include <cstdint>
#if defined(__x86_64__) || defined(_M_X64)
#include <pmmintrin.h>   // _MM_SET_DENORMALS_ZERO_MODE (SSE3)
#include <xmmintrin.h>   // _MM_SET_FLUSH_ZERO_MODE (SSE)
#endif
#include "rt/RtAssert.hpp"

namespace pg::rt {

/**
 * Puts the calling thread's floating-point unit into flush-to-zero.
 *
 * A denormal is a number too small for the exponent to represent normally, which the hardware handles
 * on a slow path: on x86-64 a microcode assist costing around a hundred cycles, per operation. They
 * appear exactly where audio dies away rather than stops -- a reverb tail, a delay's feedback, an
 * envelope's exponential decay -- so the cost arrives when the patch goes quiet, which is the least
 * likely moment for anyone to suspect the DSP. It is not heard as a wrong number; it is heard as a
 * crackle when the CPU misses its deadline, and it is very hard to attribute after the fact.
 *
 * Flush-to-zero says: when a result would be denormal, make it zero. Every audio host does this, and it
 * is the one piece of the reference host's engine we took directly (docs/adrs/0007). The approach and
 * the ARM64 register form are from VCV Rack's `system::resetFpuFlags` (GPL-3.0-or-later, VCV);
 * the x86-64 half is written with Intel's documented intrinsics rather than its raw bit constants.
 *
 * Cheap enough to do at the top of every callback rather than once per thread, which is what makes it
 * robust: the thread that renders is not always ours, and a host can reset the register underneath us.
 */
inline void flushDenormals() noexcept PG_RT_NONBLOCKING {
#if defined(__x86_64__) || defined(_M_X64)
  _MM_SET_FLUSH_ZERO_MODE(_MM_FLUSH_ZERO_ON);
  _MM_SET_DENORMALS_ZERO_MODE(_MM_DENORMALS_ZERO_ON);
#elif defined(__aarch64__) || defined(_M_ARM64)
  // FPCR bit 24 is FZ. AArch64 has no denormals-are-zero bit: inputs are handled by FZ as well.
  uint64_t fpcr = 0;
  __asm__ volatile("mrs %0, fpcr" : "=r"(fpcr));
  __asm__ volatile("msr fpcr, %0" : : "r"(fpcr | (1ull << 24)));
#endif
}

}  // namespace pg::rt
