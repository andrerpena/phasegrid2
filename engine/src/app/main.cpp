#include <cstdio>
#include <cstring>
#include "core/Version.hpp"

static int usage() {
  std::puts("phasegrid-engine\n  --version");
  return 2;
}

int main(int argc, char** argv) {
  if (argc >= 2 && std::strcmp(argv[1], "--version") == 0) {
    std::printf("%s\n", pg::engineVersion());
    return 0;
  }
  return usage();
}
