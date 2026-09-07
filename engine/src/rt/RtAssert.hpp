#pragma once
// Marks functions that run on the audio thread. With clang >= 20 and -fsanitize=realtime
// (CMake preset "rtsan") violations abort at runtime; elsewhere this is documentation.
#if defined(__has_attribute)
#if __has_attribute(clang__nonblocking) || __has_attribute(nonblocking)
#define PG_RT_NONBLOCKING [[clang::nonblocking]]
#endif
#endif
#ifndef PG_RT_NONBLOCKING
#define PG_RT_NONBLOCKING
#endif
