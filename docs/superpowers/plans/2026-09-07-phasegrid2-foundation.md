# phasegrid2 Foundation Implementation Plan (Phases 0–2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the repository, toolchain and Electron shell, then build the C++ engine foundation: device I/O, the unified signal/event model, descriptor-driven modules, the graph compiler with per-sample feedback clusters, glitch-free hot-swap, and an offline renderer that turns a JSON patch into a WAV under tests.

**Architecture:** One npm package containing an Electron/React app (`src/`), a C++20 engine (`engine/`) built by plain CMake on `postinstall`, and shared protocol types (`shared/`). The engine compiles an immutable `Program` from a `GraphModel` on the message thread and the audio thread swaps to it with one atomic exchange; module instances are reused across swaps so state is continuous. Feedback cycles (Tarjan SCCs) run per-sample with a true one-sample delay on back edges; everything else runs per block.

**Tech Stack:** C++20 (Apple clang 17), CMake ≥ 3.28 + FetchContent, Ninja (optional), miniaudio 0.11.25, moodycamel readerwriterqueue 1.0.7, nlohmann/json 3.12.0, Catch2 3.16.0; Node 22, Electron 41, electron-vite 5, Vite 6, React 19, TypeScript 5.8, Biome 2.3, Vitest 3.2, Zod 3, Zustand 5.

**Spec:** `docs/superpowers/specs/2026-09-07-phasegrid2-architecture-design.md`

## Global Constraints

- License: AGPL-3.0-only. Every third-party dependency must be MIT/BSD/BSL/MIT-0 or GPL-compatible.
- C++20, no exceptions across the audio thread, no allocation/locks/syscalls/logging inside `Module::process`, the scheduler, param drains, or program swaps. Enforced by `tests/util/RtGuard` (Task 5).
- Engine constants: `kMaxBlockSize = 256`, default block 64, `kMaxChannels = 2`, `kMaxEventsPerBlock = 256`, `kMaxPortsPerModule = 32`, `kMaxParamsPerModule = 64`.
- Signal conventions: nominal ±1 float; pitch `freq = 261.6256 * 2^(v * 10)`; MIDI note n → `(n - 60) / 120`; gate high when `> 0`; phase 0..1.
- Descriptors are C-layout (`const char*`, raw arrays, no std types) with `abiVersion = 1`.
- Registration is an explicit list (`modules/builtin.cpp`); no static-initializer registration.
- Frontend: CSS Modules + CSS custom properties, never Tailwind; tokens `--font-size-{caption,body,heading,display}` = 12/14/16/24 px and `--space-{1..4}` = 4/8/12/16 px; no inline static px.
- After any TS change run `npm run typecheck && npm run lint:fix`. After any C++ change run `npm run engine:test`.
- JSON in the engine uses nlohmann/json (glaze v8 needs C++23, which Apple clang 17 does not fully support). This is a deliberate deviation from the spec's "glaze first" wording.
- Commit after every task with a conventional message; never commit `build*/`, `out/`, `node_modules/`.

---

## File map

| Path | Responsibility |
|---|---|
| `package.json`, `tsconfig*.json`, `biome.json`, `electron.vite.config.ts`, `vitest.config.ts` | Toolchain (copied from OSMC, Tailwind removed) |
| `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/**` | Minimal Electron shell (the OSMC copy proper is phase 6) |
| `shared/protocol/version.ts` | Protocol version constant (first `/shared` file) |
| `CMakeLists.txt`, `CMakePresets.json`, `engine/CMakeLists.txt`, `engine/cmake/*.cmake` | C++ build |
| `scripts/build-native.mjs`, `scripts/dev.mjs` | postinstall build and dev launcher |
| `engine/src/core/Conventions.hpp` | Numeric constants and conversions |
| `engine/src/core/Signal.hpp` | `SignalView`, `PlanarBuffer` |
| `engine/src/core/Event.hpp/.cpp` | `Event`, `EventBuffer`, `mergeEvents` |
| `engine/src/core/Descriptor.hpp` | `PortDesc`, `ParamDesc`, `ModuleDescriptor` (C-layout) |
| `engine/src/core/Param.hpp/.cpp` | Curves, `OnePoleSmoother`, `ParamState` |
| `engine/src/core/Module.hpp` | `Module`, `VoicedModule`, `ProcessContext`, `TransportSnapshot`, `AudioBus` |
| `engine/src/core/Registry.hpp/.cpp` | Type registry, implicit param ports, validation |
| `engine/src/core/GraphModel.hpp/.cpp` | Engine-side document mirror with validation |
| `engine/src/core/Program.hpp` | `Op`, `NodeSlot`, `Program`, `ModuleInstance`, `FeedbackState` |
| `engine/src/core/InstanceTable.hpp/.cpp` | Instance reuse across compiles (hot-swap state continuity) |
| `engine/src/core/Scheduler.hpp/.cpp` | Executes ops (block mode + per-sample clusters) |
| `engine/src/core/GraphCompiler.hpp/.cpp` | GraphModel → Program (SCC, back edges, buffer allocation) |
| `engine/src/core/Engine.hpp/.cpp` | Program swap, retire queue, param queue, render entry |
| `engine/src/services/AudioDevice.hpp`, `NullBackend.hpp`, `MiniaudioBackend.hpp/.cpp`, `MiniaudioImpl.cpp`, `BlockSplitter.hpp` | Device layer |
| `engine/src/modules/AudioOut.cpp`, `builtin.cpp` | First real module + registration list |
| `engine/src/render/PatchFile.hpp/.cpp`, `OfflineRenderer.hpp/.cpp` | JSON patch → engine, engine → WAV |
| `engine/src/app/main.cpp`, `Tone.hpp` | CLI: `--version`, `--tone`, `--render` |
| `engine/tests/**` | Catch2 suites, `util/RtGuard`, `util/GraphFixture.hpp`, `modules/TestModules` |
| `docs/engine.md`, `docs/adding-a-module.md`, `CLAUDE.md` | Engineering docs |

---

### Task 1: Repository scaffold and minimal Electron shell

**Files:**
- Create: `LICENSE`, `.gitignore`, `package.json`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `biome.json`, `electron.vite.config.ts`, `vitest.config.ts`, `CLAUDE.md`, `README.md`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/App.module.css`, `src/renderer/src/env.d.ts`, `src/renderer/src/css/tokens.css`, `src/renderer/src/css/index.css`
- Create: `shared/protocol/version.ts`, `shared/protocol/version.test.ts`

**Interfaces:**
- Produces: `PROTOCOL_VERSION = 1` and `isCompatibleProtocol(major: number): boolean` in `shared/protocol/version.ts`; npm scripts `dev`, `build`, `typecheck`, `lint`, `lint:fix`, `test`.

- [ ] **Step 1: Fetch the license and write .gitignore**

```bash
cd /Users/andrepena/gitp/phasegrid2
curl -fsSL https://www.gnu.org/licenses/agpl-3.0.txt -o LICENSE
head -3 LICENSE   # expect "GNU AFFERO GENERAL PUBLIC LICENSE / Version 3, 19 November 2007"
```

`.gitignore`:
```
node_modules/
out/
dist/
build/
build-*/
*.log
*.tsbuildinfo
.DS_Store
.vscode/
.idea/
*.wav
!engine/tests/golden/*.wav
```

- [ ] **Step 2: Write package.json**

```json
{
  "name": "phasegrid2",
  "version": "0.1.0",
  "description": "Generative grid-based modular music platform",
  "author": "Andre Pena",
  "license": "AGPL-3.0-only",
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "npm run typecheck && electron-vite build",
    "start": "electron-vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "test": "vitest run --project unit"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.25.76",
    "zustand": "^5.0.10"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.3.13",
    "@electron-toolkit/preload": "^3.0.2",
    "@electron-toolkit/utils": "^4.0.0",
    "@types/node": "^22.15.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "electron": "^41.1.0",
    "electron-vite": "^5.0.0",
    "typescript": "^5.8.2",
    "vite": "^6.2.3",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 3: Write the TypeScript and tool configs**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "esnext",
    "strict": true,
    "esModuleInterop": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitAny": false,
    "noImplicitReturns": true
  },
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
```

`tsconfig.node.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "lib": ["ESNext", "DOM"],
    "outDir": "./out",
    "types": ["node"]
  },
  "include": ["src/main/**/*", "src/preload/**/*", "shared/**/*", "electron.vite.config.ts", "vitest.config.ts", "package.json"]
}
```

`tsconfig.web.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "outDir": "./out",
    "baseUrl": ".",
    "paths": { "@renderer/*": ["src/renderer/src/*"], "@shared/*": ["shared/*"] }
  },
  "include": ["src/renderer/src/**/*", "shared/**/*"]
}
```

`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.3.13/schema.json",
  "vcs": { "enabled": false, "clientKind": "git", "useIgnoreFile": false },
  "files": {
    "ignoreUnknown": false,
    "includes": ["**", "!**/build", "!**/build-*", "!**/dist", "!**/node_modules", "!**/out", "!**/.claude", "!**/coverage", "!**/storybook-static"]
  },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": { "noArrayIndexKey": "off", "noExplicitAny": "off" },
      "a11y": { "noLabelWithoutControl": "off", "noStaticElementInteractions": "off" },
      "style": { "useImportType": "error" },
      "complexity": { "noBannedTypes": "off" },
      "correctness": { "useUniqueElementIds": "off", "noNestedComponentDefinitions": "off" }
    }
  },
  "javascript": { "formatter": { "quoteStyle": "double" } }
}
```

`electron.vite.config.ts`:
```ts
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import pkg from "./package.json";

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { outDir: "out/main" } },
  preload: { plugins: [externalizeDepsPlugin()], build: { outDir: "out/preload" } },
  renderer: {
    root: "src/renderer",
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer/src"),
        "@shared": resolve(__dirname, "shared"),
      },
    },
    css: { modules: { localsConvention: "camelCase" } },
    plugins: [react()],
    build: {
      outDir: "out/renderer",
      rollupOptions: { output: { manualChunks: { "react-vendor": ["react", "react-dom"] } } },
    },
  },
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx", "shared/**/*.test.ts"],
        },
      },
    ],
  },
});
```

- [ ] **Step 4: Write the Electron main, preload and renderer files**

`src/main/index.ts`:
```ts
import { join } from "node:path";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { app, BrowserWindow, shell } from "electron";

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, "../preload/index.js"), sandbox: false },
  });
  mainWindow.on("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  electronApp.setAutoLaunch(false);
  app.on("browser-window-created", (_, window) => optimizer.watchWindowShortcuts(window));
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

`src/preload/index.ts`:
```ts
import { electronAPI } from "@electron-toolkit/preload";
import { contextBridge } from "electron";

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("electron", electronAPI);
  contextBridge.exposeInMainWorld("api", {});
} else {
  // biome-ignore lint/suspicious/noExplicitAny: preload has window without DOM types
  const win = window as any;
  win.electron = electronAPI;
  win.api = {};
}
```

`src/preload/index.d.ts`:
```ts
import type { ElectronAPI } from "@electron-toolkit/preload";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: Record<string, unknown>;
  }
}
```

`src/renderer/index.html`:
```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>phasegrid2</title>
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:;"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/env.d.ts`:
```ts
/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
```

`src/renderer/src/css/tokens.css`:
```css
:root {
  --font-size-caption: 12px;
  --font-size-body: 14px;
  --font-size-heading: 16px;
  --font-size-display: 24px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 8px;
}
```

`src/renderer/src/css/index.css`:
```css
@import "./tokens.css";

/* Provisional colors. Phase 6 replaces these with theming/apply-theme.ts writing --color-* at runtime. */
:root {
  --color-background: #1e1e1e;
  --color-foreground: #d4d4d4;
  --color-muted: #8a8a8a;
}

html,
body,
#root {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: var(--color-background);
  color: var(--color-foreground);
  font-family: "Source Code Pro", ui-monospace, Menlo, monospace;
  font-size: var(--font-size-body);
}
```

`src/renderer/src/App.module.css`:
```css
.root {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
}

.title {
  margin: 0;
  font-size: var(--font-size-display);
}

.status {
  color: var(--color-muted);
  font-size: var(--font-size-caption);
}
```

`src/renderer/src/App.tsx`:
```tsx
import styles from "./App.module.css";

export const App = () => (
  <div className={styles.root}>
    <h1 className={styles.title}>phasegrid2</h1>
    <p className={styles.status}>v{__APP_VERSION__} · engine: not connected</p>
  </div>
);
```

`src/renderer/src/main.tsx`:
```tsx
import { App } from "@renderer/App";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import "./css/index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 5: Write the first shared file and its failing test**

`shared/protocol/version.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isCompatibleProtocol, PROTOCOL_VERSION } from "./version";

describe("protocol version", () => {
  it("is 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
  it("accepts only the same major", () => {
    expect(isCompatibleProtocol(1)).toBe(true);
    expect(isCompatibleProtocol(2)).toBe(false);
  });
});
```

Run: `npm install && npm test` — Expected: FAIL (`./version` not found).

`shared/protocol/version.ts`:
```ts
/** Bumped on any breaking change to commands, events or the shm layout. */
export const PROTOCOL_VERSION = 1 as const;

export function isCompatibleProtocol(engineMajor: number): boolean {
  return engineMajor === PROTOCOL_VERSION;
}
```

Run: `npm test` — Expected: PASS (2 tests).

- [ ] **Step 6: Write CLAUDE.md and README.md**

`CLAUDE.md`:
```markdown
# CLAUDE.md

phasegrid2 is a generative, grid-based modular music platform (Bitwig Grid-like). AGPL-3.0.
Spec: docs/superpowers/specs/2026-09-07-phasegrid2-architecture-design.md. Engine rules: docs/engine.md.

## Commands
- `npm run dev` — build engine (incremental) and start Electron with HMR
- `npm run typecheck && npm run lint:fix` — REQUIRED after any TypeScript change
- `npm test` — vitest unit project
- `npm run engine:build` / `npm run engine:test` — CMake build and Catch2 tests; REQUIRED after any C++ change
- `npm run engine:render -- patch.json --seconds 2 --out out.wav` — headless render

## Layout
- `engine/` C++20 audio engine (separate process). `src/core` graph/scheduler, `src/modules` one file per module, `src/services` device/midi/telemetry/socket, `tests/` Catch2.
- `native/` N-API shared-memory reader (phase 5).
- `shared/` protocol schemas shared by main/preload/renderer.
- `src/main`, `src/preload`, `src/renderer` Electron (electron-vite). Alias `@renderer` → `src/renderer/src`, `@shared` → `shared`.

## Rules
- Audio thread code (`Module::process`, scheduler, param drain, program swap): no allocation, locks, syscalls, exceptions, logging. Tests assert this.
- Adding a module = one `.cpp` in `engine/src/modules` + one line in `builtin.cpp`. No TypeScript changes.
- Styling: CSS Modules + CSS custom properties only. No Tailwind. Use `--font-size-*` and `--space-*` tokens; no inline static px.
- Descriptors are C-layout; never put std types in them.
```

`README.md`:
```markdown
# phasegrid2

Generative, grid-based modular music platform. Electron + Pixi.js frontend, C++20 audio engine process. AGPL-3.0.

## Requirements (macOS first)
- Node 22, npm 10
- CMake ≥ 3.28 (`brew install cmake`), Xcode Command Line Tools (`xcode-select --install`), Ninja optional (`brew install ninja`)

## Run
```
npm install     # builds the engine
npm run dev
```
```

- [ ] **Step 7: Verify install, typecheck, lint, test, and the window**

```bash
npm install
npm run typecheck
npm run lint:fix
npm test
npm run dev   # a window titled phasegrid2 shows "engine: not connected"; Ctrl+C to stop
```
Expected: all commands exit 0; window appears.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold phasegrid2 repo with minimal Electron shell"
```

---

### Task 2: CMake build, engine executable skeleton, Catch2 smoke test, postinstall script, CI

**Files:**
- Create: `CMakeLists.txt`, `CMakePresets.json`, `engine/CMakeLists.txt`, `engine/cmake/Deps.cmake`, `engine/cmake/Warnings.cmake`
- Create: `engine/src/core/Version.hpp`, `engine/src/core/Version.cpp`, `engine/src/app/main.cpp`
- Create: `engine/tests/test_smoke.cpp`
- Create: `scripts/build-native.mjs`, `scripts/dev.mjs`, `.github/workflows/ci.yml`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: CMake targets `pg_core` (static lib, `PUBLIC` include `engine/src`), `phasegrid-engine` (exe), `pg_tests` (Catch2). Binary at `build/engine/phasegrid-engine`. `pg::engineVersion()` returns `"0.1.0"`. npm scripts `postinstall`, `engine:build`, `engine:test`, `engine:render`.

- [ ] **Step 1: Write the smoke test first**

`engine/tests/test_smoke.cpp`:
```cpp
#include <catch2/catch_test_macros.hpp>
#include "core/Version.hpp"

TEST_CASE("engine reports a version", "[smoke]") {
  REQUIRE(std::string(pg::engineVersion()) == "0.1.0");
}
```

- [ ] **Step 2: Write the CMake files**

`CMakeLists.txt` (root):
```cmake
cmake_minimum_required(VERSION 3.28)
project(phasegrid2 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo CACHE STRING "" FORCE)
endif()

option(PG_BUILD_TESTS "Build engine tests" ON)

enable_testing()
add_subdirectory(engine)
```

`CMakePresets.json`:
```json
{
  "version": 6,
  "configurePresets": [
    { "name": "dev", "generator": "Ninja", "binaryDir": "${sourceDir}/build-dev",
      "cacheVariables": { "CMAKE_BUILD_TYPE": "Debug" } },
    { "name": "asan", "inherits": "dev", "binaryDir": "${sourceDir}/build-asan",
      "cacheVariables": { "CMAKE_CXX_FLAGS": "-fsanitize=address,undefined -fno-omit-frame-pointer",
                          "CMAKE_EXE_LINKER_FLAGS": "-fsanitize=address,undefined" } },
    { "name": "rtsan", "inherits": "dev", "binaryDir": "${sourceDir}/build-rtsan",
      "cacheVariables": { "CMAKE_C_COMPILER": "/opt/homebrew/opt/llvm/bin/clang",
                          "CMAKE_CXX_COMPILER": "/opt/homebrew/opt/llvm/bin/clang++",
                          "CMAKE_CXX_FLAGS": "-fsanitize=realtime", "CMAKE_EXE_LINKER_FLAGS": "-fsanitize=realtime" } }
  ],
  "buildPresets": [
    { "name": "dev", "configurePreset": "dev" },
    { "name": "asan", "configurePreset": "asan" },
    { "name": "rtsan", "configurePreset": "rtsan" }
  ],
  "testPresets": [
    { "name": "dev", "configurePreset": "dev", "output": { "outputOnFailure": true } },
    { "name": "asan", "configurePreset": "asan", "output": { "outputOnFailure": true } }
  ]
}
```

`engine/cmake/Warnings.cmake`:
```cmake
function(pg_apply_warnings target)
  target_compile_options(${target} PRIVATE
    -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Wno-sign-conversion
    -Werror=return-type -Werror=switch)
endfunction()
```

`engine/cmake/Deps.cmake`:
```cmake
include(FetchContent)
set(FETCHCONTENT_QUIET OFF)

FetchContent_Declare(readerwriterqueue
  GIT_REPOSITORY https://github.com/cameron314/readerwriterqueue.git GIT_TAG v1.0.7 GIT_SHALLOW TRUE)
FetchContent_Declare(nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git GIT_TAG v3.12.0 GIT_SHALLOW TRUE)
# SOURCE_SUBDIR points at a directory that does not exist so miniaudio's own CMakeLists is not added.
FetchContent_Declare(miniaudio
  GIT_REPOSITORY https://github.com/mackron/miniaudio.git GIT_TAG 0.11.25 GIT_SHALLOW TRUE
  SOURCE_SUBDIR cmake_disabled)
FetchContent_Declare(Catch2
  GIT_REPOSITORY https://github.com/catchorg/Catch2.git GIT_TAG v3.16.0 GIT_SHALLOW TRUE)

set(JSON_BuildTests OFF CACHE INTERNAL "")
FetchContent_MakeAvailable(readerwriterqueue nlohmann_json miniaudio)

add_library(miniaudio_headers INTERFACE)
target_include_directories(miniaudio_headers INTERFACE ${miniaudio_SOURCE_DIR})

if(PG_BUILD_TESTS)
  FetchContent_MakeAvailable(Catch2)
  list(APPEND CMAKE_MODULE_PATH ${catch2_SOURCE_DIR}/extras)
  set(CMAKE_MODULE_PATH ${CMAKE_MODULE_PATH} PARENT_SCOPE)
endif()
```

`engine/CMakeLists.txt`:
```cmake
include(cmake/Warnings.cmake)
include(cmake/Deps.cmake)

file(GLOB_RECURSE PG_CORE_SOURCES CONFIGURE_DEPENDS
  src/core/*.cpp src/services/*.cpp src/render/*.cpp src/modules/*.cpp
  src/dsp/*.cpp src/protocol/*.cpp src/platform/*.cpp)

add_library(pg_core STATIC ${PG_CORE_SOURCES})
target_include_directories(pg_core PUBLIC src)
target_link_libraries(pg_core PUBLIC readerwriterqueue nlohmann_json::nlohmann_json miniaudio_headers)
pg_apply_warnings(pg_core)
if(APPLE)
  target_link_libraries(pg_core PUBLIC "-framework CoreAudio" "-framework CoreFoundation" "-framework AudioToolbox")
endif()

add_executable(phasegrid-engine src/app/main.cpp)
target_link_libraries(phasegrid-engine PRIVATE pg_core)
pg_apply_warnings(phasegrid-engine)

if(PG_BUILD_TESTS)
  file(GLOB_RECURSE PG_TEST_SOURCES CONFIGURE_DEPENDS tests/*.cpp)
  add_executable(pg_tests ${PG_TEST_SOURCES})
  target_include_directories(pg_tests PRIVATE tests)
  target_compile_definitions(pg_tests PRIVATE PG_TEST_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests")
  target_link_libraries(pg_tests PRIVATE pg_core Catch2::Catch2WithMain)
  include(Catch)
  catch_discover_tests(pg_tests)
endif()
```

- [ ] **Step 3: Write Version and main**

`engine/src/core/Version.hpp`:
```cpp
#pragma once
namespace pg {
const char* engineVersion();
}
```

`engine/src/core/Version.cpp`:
```cpp
#include "core/Version.hpp"
namespace pg {
const char* engineVersion() { return "0.1.0"; }
}
```

`engine/src/app/main.cpp`:
```cpp
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
```

- [ ] **Step 4: Configure, build, run the smoke test**

```bash
cd /Users/andrepena/gitp/phasegrid2
cmake -S . -B build -G Ninja
cmake --build build --target phasegrid-engine pg_tests
./build/engine/phasegrid-engine --version      # expect 0.1.0
ctest --test-dir build --output-on-failure     # expect 1 test passed
```

- [ ] **Step 5: Write the build and dev scripts**

`scripts/build-native.mjs`:
```js
#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = resolve(root, "build");

if (process.env.PHASEGRID_SKIP_NATIVE === "1") {
  console.log("[build-native] skipped (PHASEGRID_SKIP_NATIVE=1)");
  process.exit(0);
}

const has = (cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
if (!has("cmake")) {
  console.error("[build-native] cmake not found. macOS: `brew install cmake` and `xcode-select --install`.");
  process.exit(1);
}

const cmake = (args) => {
  const r = spawnSync("cmake", args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!existsSync(resolve(buildDir, "CMakeCache.txt"))) {
  const gen = has("ninja") ? ["-G", "Ninja"] : [];
  cmake(["-S", root, "-B", buildDir, "-DCMAKE_BUILD_TYPE=RelWithDebInfo", ...gen]);
}
const targets = process.argv.includes("--tests") ? ["phasegrid-engine", "pg_tests"] : ["phasegrid-engine"];
cmake(["--build", buildDir, "--target", ...targets, "--parallel"]);
console.log("[build-native] ok: build/engine/phasegrid-engine");
```

`scripts/dev.mjs`:
```js
#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const build = spawnSync(process.execPath, [resolve(root, "scripts/build-native.mjs")], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const bin = resolve(root, "node_modules/.bin/electron-vite");
const child = spawn(bin, ["dev"], { cwd: root, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
```

Update `package.json` scripts (replace the `dev` line, add the rest):
```json
"postinstall": "node scripts/build-native.mjs",
"dev": "node scripts/dev.mjs",
"engine:build": "node scripts/build-native.mjs --tests",
"engine:test": "node scripts/build-native.mjs --tests && ctest --test-dir build --output-on-failure",
"engine:render": "./build/engine/phasegrid-engine --render"
```

- [ ] **Step 6: Write CI**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: brew install ninja
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run engine:test
```

- [ ] **Step 7: Verify the npm entry points**

```bash
rm -rf build
npm install                 # postinstall configures + builds the engine
npm run engine:test         # builds pg_tests, ctest passes
npm run lint:fix && npm run typecheck
```
Expected: all exit 0; `build/engine/phasegrid-engine --version` prints `0.1.0`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "build: CMake engine skeleton, Catch2 smoke test, postinstall build script, CI"
```

---

### Task 3: Audio device interface, NullBackend, BlockSplitter

**Files:**
- Create: `engine/src/services/AudioDevice.hpp`, `engine/src/services/NullBackend.hpp`, `engine/src/services/BlockSplitter.hpp`
- Test: `engine/tests/test_block_splitter.cpp`

**Interfaces:**
- Produces: `pg::AudioDeviceBackend` (abstract: `name()`, `enumerate()`, `open(config, RenderFn, error&)`, `close()`, `isOpen()`, `sampleRate()`, `channels()`), `pg::NullBackend::pump(float* interleaved, uint32_t frames)`, `pg::BlockSplitter::prepare(blockSize, channels)` / `render(float* interleaved, uint32_t frames, const BlockFn&)` where `BlockFn = std::function<void(float* interleaved, uint32_t frames)>`.

- [ ] **Step 1: Write the failing test**

`engine/tests/test_block_splitter.cpp`:
```cpp
#include <catch2/catch_test_macros.hpp>
#include <vector>
#include "services/BlockSplitter.hpp"
#include "services/NullBackend.hpp"

TEST_CASE("BlockSplitter renders fixed blocks for arbitrary periods", "[device]") {
  pg::BlockSplitter splitter;
  splitter.prepare(64, 2);
  uint32_t calls = 0;
  float counter = 0.f;
  auto block = [&](float* out, uint32_t frames) {
    REQUIRE(frames == 64);
    ++calls;
    for (uint32_t i = 0; i < frames; ++i) { out[i * 2] = counter; out[i * 2 + 1] = -counter; counter += 1.f; }
  };
  std::vector<float> out(100 * 2);
  splitter.render(out.data(), 100, block);
  REQUIRE(calls == 2);
  std::vector<float> out2(100 * 2);
  splitter.render(out2.data(), 100, block);
  REQUIRE(calls == 4);
  // Continuity across requests: sample 100 follows sample 99.
  REQUIRE(out[99 * 2] == 99.f);
  REQUIRE(out2[0] == 100.f);
  REQUIRE(out2[0 + 1] == -100.f);
  REQUIRE(out2[99 * 2] == 199.f);
}

TEST_CASE("NullBackend drives the render callback", "[device]") {
  pg::NullBackend backend;
  std::string err;
  uint32_t seen = 0;
  REQUIRE(backend.open(pg::DeviceConfig{}, [&](float*, uint32_t frames, uint32_t ch) { seen += frames * ch; }, err));
  REQUIRE(backend.isOpen());
  std::vector<float> buf(128 * 2);
  backend.pump(buf.data(), 128);
  REQUIRE(seen == 256);
  backend.close();
  REQUIRE_FALSE(backend.isOpen());
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run engine:test` — Expected: compile error, headers missing.

- [ ] **Step 3: Write the implementation**

`engine/src/services/AudioDevice.hpp`:
```cpp
#pragma once
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace pg {

struct DeviceInfo {
  std::string id;
  std::string name;
  bool isDefault = false;
};

struct DeviceConfig {
  std::string deviceId;          // empty = system default
  double sampleRate = 48000.0;
  uint32_t periodFrames = 128;   // requested device period
  uint32_t channels = 2;
};

/// Called on the device's real-time thread. Must fill frames*channels interleaved floats.
using RenderFn = std::function<void(float* interleavedOut, uint32_t frames, uint32_t channels)>;

class AudioDeviceBackend {
public:
  virtual ~AudioDeviceBackend() = default;
  virtual std::string name() const = 0;
  virtual std::vector<DeviceInfo> enumerate() = 0;
  virtual bool open(const DeviceConfig& config, RenderFn render, std::string& error) = 0;
  virtual void close() = 0;
  virtual bool isOpen() const = 0;
  virtual double sampleRate() const = 0;   // actual rate after open
  virtual uint32_t channels() const = 0;
};

}  // namespace pg
```

`engine/src/services/NullBackend.hpp`:
```cpp
#pragma once
#include "services/AudioDevice.hpp"

namespace pg {

/// No device. Used by the offline renderer and tests; `pump` plays the role of the device callback.
class NullBackend final : public AudioDeviceBackend {
public:
  std::string name() const override { return "null"; }
  std::vector<DeviceInfo> enumerate() override { return {DeviceInfo{"null", "Null Output", true}}; }
  bool open(const DeviceConfig& config, RenderFn render, std::string&) override {
    config_ = config; render_ = std::move(render); open_ = true; return true;
  }
  void close() override { open_ = false; render_ = nullptr; }
  bool isOpen() const override { return open_; }
  double sampleRate() const override { return config_.sampleRate; }
  uint32_t channels() const override { return config_.channels; }

  void pump(float* interleavedOut, uint32_t frames) {
    if (render_) render_(interleavedOut, frames, config_.channels);
  }

private:
  DeviceConfig config_;
  RenderFn render_;
  bool open_ = false;
};

}  // namespace pg
```

`engine/src/services/BlockSplitter.hpp`:
```cpp
#pragma once
#include <algorithm>
#include <cstdint>
#include <functional>
#include <vector>

namespace pg {

/// Adapts arbitrary device period sizes to fixed engine blocks. RT-safe after prepare().
class BlockSplitter {
public:
  using BlockFn = std::function<void(float* interleavedOut, uint32_t frames)>;  // frames == blockSize

  void prepare(uint32_t blockSize, uint32_t channels) {
    blockSize_ = blockSize; channels_ = channels;
    carry_.assign(static_cast<size_t>(blockSize) * channels, 0.f);
    carryPos_ = 0; carryCount_ = 0;
  }

  void render(float* out, uint32_t frames, const BlockFn& block) {
    uint32_t written = 0;
    while (written < frames) {
      if (carryCount_ == 0) { block(carry_.data(), blockSize_); carryPos_ = 0; carryCount_ = blockSize_; }
      const uint32_t n = std::min(frames - written, carryCount_);
      std::copy_n(carry_.data() + static_cast<size_t>(carryPos_) * channels_,
                  static_cast<size_t>(n) * channels_,
                  out + static_cast<size_t>(written) * channels_);
      written += n; carryPos_ += n; carryCount_ -= n;
    }
  }

  uint32_t blockSize() const { return blockSize_; }

private:
  uint32_t blockSize_ = 64, channels_ = 2, carryPos_ = 0, carryCount_ = 0;
  std::vector<float> carry_;
};

}  // namespace pg
```

- [ ] **Step 4: Run the tests**

Run: `npm run engine:test` — Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add engine
git commit -m "feat(engine): audio device interface, NullBackend, BlockSplitter"
```

---

### Task 4: MiniaudioBackend and `--tone`

**Files:**
- Create: `engine/src/services/MiniaudioImpl.cpp`, `engine/src/services/MiniaudioBackend.hpp`, `engine/src/services/MiniaudioBackend.cpp`, `engine/src/app/Tone.hpp`
- Modify: `engine/CMakeLists.txt` (suppress warnings for MiniaudioImpl.cpp), `engine/src/app/main.cpp`
- Test: `engine/tests/test_tone.cpp`

**Interfaces:**
- Produces: `pg::MiniaudioBackend` implementing `AudioDeviceBackend`; `pg::ToneGenerator{prepare(sampleRate, hz), render(float* interleaved, frames, channels)}`; CLI `phasegrid-engine --tone [seconds]`.

- [ ] **Step 1: Write the failing tone test**

`engine/tests/test_tone.cpp`:
```cpp
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <vector>
#include "app/Tone.hpp"

TEST_CASE("ToneGenerator produces a sine at the requested frequency", "[tone]") {
  pg::ToneGenerator tone;
  tone.prepare(48000.0, 1000.0);   // 48 samples per cycle
  std::vector<float> buf(96 * 2);
  tone.render(buf.data(), 96, 2);
  REQUIRE(buf[0] == Catch::Approx(0.f).margin(1e-6));
  REQUIRE(buf[12 * 2] == Catch::Approx(tone.amp).margin(1e-4));       // quarter cycle
  REQUIRE(buf[48 * 2] == Catch::Approx(0.f).margin(1e-4));            // full cycle
  REQUIRE(buf[12 * 2 + 1] == buf[12 * 2]);                             // both channels
}
```

- [ ] **Step 2: Write Tone.hpp**

`engine/src/app/Tone.hpp`:
```cpp
#pragma once
#include <cmath>
#include <cstdint>

namespace pg {

struct ToneGenerator {
  double phase = 0.0, inc = 0.0;
  float amp = 0.25f;
  void prepare(double sampleRate, double hz) { inc = hz / sampleRate; phase = 0.0; }
  void render(float* out, uint32_t frames, uint32_t channels) {
    for (uint32_t f = 0; f < frames; ++f) {
      const float s = amp * static_cast<float>(std::sin(2.0 * M_PI * phase));
      phase += inc; if (phase >= 1.0) phase -= 1.0;
      for (uint32_t c = 0; c < channels; ++c) out[f * channels + c] = s;
    }
  }
};

}  // namespace pg
```

Run: `npm run engine:test` — Expected: tone test passes (tests dir is on the include path; `app/Tone.hpp` resolves through `pg_core`'s public include `engine/src`).

- [ ] **Step 3: Write the miniaudio backend**

`engine/src/services/MiniaudioImpl.cpp`:
```cpp
// Single translation unit holding the miniaudio implementation. Compiled with warnings off.
#define MINIAUDIO_IMPLEMENTATION
#define MA_NO_GENERATION
#include "miniaudio.h"
```

`engine/src/services/MiniaudioBackend.hpp`:
```cpp
#pragma once
#include <memory>
#include "services/AudioDevice.hpp"

struct ma_context;
struct ma_device;

namespace pg {

class MiniaudioBackend final : public AudioDeviceBackend {
public:
  MiniaudioBackend();
  ~MiniaudioBackend() override;
  std::string name() const override { return "miniaudio"; }
  std::vector<DeviceInfo> enumerate() override;
  bool open(const DeviceConfig& config, RenderFn render, std::string& error) override;
  void close() override;
  bool isOpen() const override { return open_; }
  double sampleRate() const override { return sampleRate_; }
  uint32_t channels() const override { return channels_; }

  // Called from the device thread.
  void onData(float* out, uint32_t frames, uint32_t channels) { if (render_) render_(out, frames, channels); }

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  RenderFn render_;
  bool open_ = false;
  double sampleRate_ = 0.0;
  uint32_t channels_ = 0;
};

}  // namespace pg
```

`engine/src/services/MiniaudioBackend.cpp`:
```cpp
#include "services/MiniaudioBackend.hpp"
#include <cstring>
#include <vector>
#include "miniaudio.h"

namespace pg {

struct MiniaudioBackend::Impl {
  ma_context context{};
  bool contextInit = false;
  ma_device device{};
  bool deviceInit = false;
  std::vector<ma_device_info> playback;   // cache from last enumerate(); ids are indices
};

static void dataCallback(ma_device* dev, void* out, const void*, ma_uint32 frames) {
  auto* self = static_cast<MiniaudioBackend*>(dev->pUserData);
  self->onData(static_cast<float*>(out), frames, dev->playback.channels);
}

MiniaudioBackend::MiniaudioBackend() : impl_(std::make_unique<Impl>()) {
  impl_->contextInit = ma_context_init(nullptr, 0, nullptr, &impl_->context) == MA_SUCCESS;
}

MiniaudioBackend::~MiniaudioBackend() {
  close();
  if (impl_->contextInit) ma_context_uninit(&impl_->context);
}

std::vector<DeviceInfo> MiniaudioBackend::enumerate() {
  std::vector<DeviceInfo> out;
  if (!impl_->contextInit) return out;
  ma_device_info* infos = nullptr; ma_uint32 count = 0;
  if (ma_context_get_devices(&impl_->context, &infos, &count, nullptr, nullptr) != MA_SUCCESS) return out;
  impl_->playback.assign(infos, infos + count);
  for (ma_uint32 i = 0; i < count; ++i)
    out.push_back(DeviceInfo{std::to_string(i), infos[i].name, infos[i].isDefault != 0});
  return out;
}

bool MiniaudioBackend::open(const DeviceConfig& config, RenderFn render, std::string& error) {
  if (!impl_->contextInit) { error = "miniaudio context init failed"; return false; }
  close();
  render_ = std::move(render);
  ma_device_config cfg = ma_device_config_init(ma_device_type_playback);
  cfg.playback.format = ma_format_f32;
  cfg.playback.channels = config.channels;
  cfg.sampleRate = static_cast<ma_uint32>(config.sampleRate);
  cfg.periodSizeInFrames = config.periodFrames;
  cfg.dataCallback = dataCallback;
  cfg.pUserData = this;
  if (!config.deviceId.empty()) {
    if (impl_->playback.empty()) enumerate();
    const size_t idx = std::stoul(config.deviceId);
    if (idx >= impl_->playback.size()) { error = "unknown device id " + config.deviceId; return false; }
    cfg.playback.pDeviceID = &impl_->playback[idx].id;
  }
  if (ma_device_init(&impl_->context, &cfg, &impl_->device) != MA_SUCCESS) { error = "ma_device_init failed"; return false; }
  impl_->deviceInit = true;
  if (ma_device_start(&impl_->device) != MA_SUCCESS) { error = "ma_device_start failed"; close(); return false; }
  sampleRate_ = impl_->device.sampleRate;
  channels_ = impl_->device.playback.channels;
  open_ = true;
  return true;
}

void MiniaudioBackend::close() {
  if (impl_->deviceInit) { ma_device_uninit(&impl_->device); impl_->deviceInit = false; }
  open_ = false; render_ = nullptr;
}

}  // namespace pg
```

Add to `engine/CMakeLists.txt` after `pg_apply_warnings(pg_core)`:
```cmake
set_source_files_properties(src/services/MiniaudioImpl.cpp PROPERTIES COMPILE_OPTIONS "-w")
```

- [ ] **Step 4: Add `--tone` to main**

Replace `engine/src/app/main.cpp`:
```cpp
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <thread>
#include "app/Tone.hpp"
#include "core/Version.hpp"
#include "services/BlockSplitter.hpp"
#include "services/MiniaudioBackend.hpp"

static int usage() {
  std::puts("phasegrid-engine\n  --version\n  --tone [seconds]      play a 440 Hz test tone on the default device");
  return 2;
}

static int runTone(int seconds) {
  pg::MiniaudioBackend backend;
  for (const auto& d : backend.enumerate())
    std::printf("device %s: %s%s\n", d.id.c_str(), d.name.c_str(), d.isDefault ? " (default)" : "");
  pg::ToneGenerator tone;
  pg::BlockSplitter splitter;
  splitter.prepare(64, 2);
  std::string err;
  pg::DeviceConfig cfg;
  const bool ok = backend.open(cfg, [&](float* out, uint32_t frames, uint32_t channels) {
    splitter.render(out, frames, [&](float* block, uint32_t n) { tone.render(block, n, channels); });
  }, err);
  if (!ok) { std::fprintf(stderr, "open failed: %s\n", err.c_str()); return 1; }
  tone.prepare(backend.sampleRate(), 440.0);
  std::printf("playing %d s at %.0f Hz, %u ch\n", seconds, backend.sampleRate(), backend.channels());
  std::this_thread::sleep_for(std::chrono::seconds(seconds));
  backend.close();
  return 0;
}

int main(int argc, char** argv) {
  if (argc >= 2 && std::strcmp(argv[1], "--version") == 0) { std::printf("%s\n", pg::engineVersion()); return 0; }
  if (argc >= 2 && std::strcmp(argv[1], "--tone") == 0) return runTone(argc >= 3 ? std::atoi(argv[2]) : 3);
  return usage();
}
```

Note: `tone.prepare` is called after `open` because the sample rate is only known then; the first few callbacks output silence, which is fine for a test tone.

- [ ] **Step 5: Build and listen**

```bash
npm run engine:build
./build/engine/phasegrid-engine --tone 3
```
Expected: device list printed, a clean 440 Hz tone for 3 s, no clicks, exit 0.

- [ ] **Step 6: Commit**

```bash
git add engine
git commit -m "feat(engine): miniaudio backend and --tone smoke command"
```

---

### Task 5: Real-time allocation guard

**Files:**
- Create: `engine/tests/util/RtGuard.hpp`, `engine/tests/util/RtGuard.cpp`, `engine/src/rt/RtAssert.hpp`
- Test: `engine/tests/test_rt_alloc.cpp`

**Interfaces:**
- Produces: `pg::test::RtScope` (RAII; any global `new`/`delete` inside counts as a violation), `pg::test::rtViolations()`, `pg::test::resetRtViolations()`. `PG_RT_NONBLOCKING` macro expanding to `[[clang::nonblocking]]` when available.

- [ ] **Step 1: Write the failing test**

`engine/tests/test_rt_alloc.cpp`:
```cpp
#include <catch2/catch_test_macros.hpp>
#include <vector>
#include "app/Tone.hpp"
#include "services/BlockSplitter.hpp"
#include "util/RtGuard.hpp"

TEST_CASE("RtScope detects heap allocation", "[rt]") {
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; std::vector<int> v(64); (void)v; }
  REQUIRE(pg::test::rtViolations() > 0);
}

TEST_CASE("tone + block splitter do not allocate on the render path", "[rt]") {
  pg::ToneGenerator tone; tone.prepare(48000.0, 440.0);
  pg::BlockSplitter splitter; splitter.prepare(64, 2);
  std::vector<float> out(100 * 2);
  pg::BlockSplitter::BlockFn block = [&](float* b, uint32_t n) { tone.render(b, n, 2); };
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; for (int i = 0; i < 50; ++i) splitter.render(out.data(), 100, block); }
  REQUIRE(pg::test::rtViolations() == 0);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run engine:test` — Expected: compile error, `util/RtGuard.hpp` missing.

- [ ] **Step 3: Write the guard**

`engine/tests/util/RtGuard.hpp`:
```cpp
#pragma once
#include <cstdint>

namespace pg::test {
/// While an RtScope is alive on this thread, every global operator new/delete increments the violation counter.
struct RtScope {
  RtScope();
  ~RtScope();
  RtScope(const RtScope&) = delete;
  RtScope& operator=(const RtScope&) = delete;
};
uint64_t rtViolations();
void resetRtViolations();
}  // namespace pg::test
```

`engine/tests/util/RtGuard.cpp`:
```cpp
#include "util/RtGuard.hpp"
#include <atomic>
#include <cstdlib>
#include <new>

namespace {
thread_local int g_depth = 0;
std::atomic<uint64_t> g_violations{0};
inline void note() { if (g_depth > 0) g_violations.fetch_add(1, std::memory_order_relaxed); }
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
```

`engine/src/rt/RtAssert.hpp`:
```cpp
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
```

- [ ] **Step 4: Run the tests**

Run: `npm run engine:test` — Expected: all pass, including both `[rt]` tests. If the first test reports zero violations, the override is not linked; check that `tests/util/RtGuard.cpp` is in `PG_TEST_SOURCES` (the recursive glob covers it).

- [ ] **Step 5: Commit**

```bash
git add engine
git commit -m "test(engine): RT allocation guard and first RT-safety test"
```

---

### Task 6: Conventions, signal views, event buffers

**Files:**
- Create: `engine/src/core/Conventions.hpp`, `engine/src/core/Signal.hpp`, `engine/src/core/Event.hpp`, `engine/src/core/Event.cpp`
- Test: `engine/tests/test_signal.cpp`, `engine/tests/test_event.cpp`

**Interfaces:**
- Produces: constants `pg::kMaxBlockSize=256`, `kMaxChannels=2`, `kMaxEventsPerBlock=256`, `kMaxPortsPerModule=32`, `kMaxParamsPerModule=64`; `pitchToHz(float)`, `midiNoteToPitch(float)`, `gateHigh(float)`.
- `pg::SignalView { std::array<float*,kMaxChannels> ch; uint32_t numChannels, numFrames; read(c); write(c); slice(offset,n); clear(); }`
- `pg::PlanarBuffer { float* data(c); const float* data(c) const; void clear(); }`
- `pg::Event { uint32_t frame; EventType type; uint8_t channel, flags; uint32_t noteId; float a,b,c; }`, `pg::EventBuffer { bool push(const Event&); void clear(); uint32_t size() const; const Event& operator[](i) const; begin()/end(); }`, `void pg::mergeEvents(const EventBuffer* const* sources, uint32_t n, EventBuffer& dst)`.

- [ ] **Step 1: Write the failing tests**

`engine/tests/test_signal.cpp`:
```cpp
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include "core/Conventions.hpp"
#include "core/Signal.hpp"

TEST_CASE("pitch and gate conventions", "[core]") {
  REQUIRE(pg::pitchToHz(0.f) == Catch::Approx(261.6256f));
  REQUIRE(pg::pitchToHz(0.1f) == Catch::Approx(523.2512f).epsilon(1e-4));
  REQUIRE(pg::midiNoteToPitch(72.f) == Catch::Approx(0.1f));
  REQUIRE(pg::gateHigh(0.5f));
  REQUIRE_FALSE(pg::gateHigh(0.f));
}

TEST_CASE("SignalView broadcasts mono to stereo readers and slices", "[core]") {
  pg::PlanarBuffer buf;
  for (uint32_t i = 0; i < 8; ++i) buf.data(0)[i] = static_cast<float>(i);
  pg::SignalView v = buf.view(1, 8);
  REQUIRE(v.numChannels == 1);
  REQUIRE(v.read(1)[3] == 3.f);          // channel 1 reads channel 0
  pg::SignalView s = v.slice(4, 2);
  REQUIRE(s.numFrames == 2);
  REQUIRE(s.read(0)[0] == 4.f);
  s.clear();
  REQUIRE(buf.data(0)[4] == 0.f);
  REQUIRE(buf.data(0)[6] == 6.f);
}
```

`engine/tests/test_event.cpp`:
```cpp
#include <catch2/catch_test_macros.hpp>
#include "core/Event.hpp"

TEST_CASE("EventBuffer keeps frame order and rejects overflow", "[core]") {
  pg::EventBuffer b;
  REQUIRE(b.push(pg::Event{.frame = 3}));
  REQUIRE(b.push(pg::Event{.frame = 3}));
  REQUIRE_FALSE(b.push(pg::Event{.frame = 2}));   // out of order
  REQUIRE(b.size() == 2);
  b.clear();
  for (uint32_t i = 0; i < pg::kMaxEventsPerBlock; ++i) REQUIRE(b.push(pg::Event{.frame = i}));
  REQUIRE_FALSE(b.push(pg::Event{.frame = 300}));
}

TEST_CASE("mergeEvents is a stable k-way merge by frame", "[core]") {
  pg::EventBuffer a, b, dst;
  a.push(pg::Event{.frame = 1, .a = 1.f}); a.push(pg::Event{.frame = 5, .a = 2.f});
  b.push(pg::Event{.frame = 0, .a = 3.f}); b.push(pg::Event{.frame = 5, .a = 4.f});
  const pg::EventBuffer* srcs[] = {&a, &b};
  pg::mergeEvents(srcs, 2, dst);
  REQUIRE(dst.size() == 4);
  REQUIRE(dst[0].a == 3.f);
  REQUIRE(dst[1].a == 1.f);
  REQUIRE(dst[2].a == 2.f);   // a before b on equal frame
  REQUIRE(dst[3].a == 4.f);
}
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run engine:test` — Expected: compile errors (headers missing).

- [ ] **Step 3: Write the headers**

`engine/src/core/Conventions.hpp`:
```cpp
#pragma once
#include <cmath>
#include <cstdint>

namespace pg {

inline constexpr uint32_t kMaxBlockSize = 256;
inline constexpr uint32_t kDefaultBlockSize = 64;
inline constexpr uint32_t kMaxChannels = 2;
inline constexpr uint32_t kMaxEventsPerBlock = 256;
inline constexpr uint32_t kMaxPortsPerModule = 32;
inline constexpr uint32_t kMaxParamsPerModule = 64;

inline constexpr float kOctavesPerUnit = 10.f;
inline constexpr float kMiddleCHz = 261.6256f;

inline float pitchToHz(float v) { return kMiddleCHz * std::exp2(v * kOctavesPerUnit); }
inline float hzToPitch(float hz) { return std::log2(hz / kMiddleCHz) / kOctavesPerUnit; }
inline float midiNoteToPitch(float note) { return (note - 60.f) / 120.f; }
inline bool gateHigh(float v) { return v > 0.f; }

}  // namespace pg
```

`engine/src/core/Signal.hpp`:
```cpp
#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include "core/Conventions.hpp"

namespace pg {

/// Non-owning planar view. Mono views broadcast to any channel index on read.
struct SignalView {
  std::array<float*, kMaxChannels> ch{};
  uint32_t numChannels = 0;
  uint32_t numFrames = 0;

  const float* read(uint32_t c) const { return ch[c < numChannels ? c : numChannels - 1]; }
  float* write(uint32_t c) const { return ch[c]; }
  bool empty() const { return numChannels == 0; }

  SignalView slice(uint32_t offset, uint32_t n) const {
    SignalView s = *this;
    for (uint32_t c = 0; c < numChannels; ++c) s.ch[c] += offset;
    s.numFrames = n;
    return s;
  }
  void clear() const {
    for (uint32_t c = 0; c < numChannels; ++c) std::fill_n(ch[c], numFrames, 0.f);
  }
};

/// Owns kMaxChannels * kMaxBlockSize floats. Allocated by the compiler on the message thread.
class PlanarBuffer {
public:
  float* data(uint32_t c) { return data_.data() + static_cast<size_t>(c) * kMaxBlockSize; }
  const float* data(uint32_t c) const { return data_.data() + static_cast<size_t>(c) * kMaxBlockSize; }
  void clear() { data_.fill(0.f); }
  SignalView view(uint32_t channels, uint32_t frames) {
    SignalView v; v.numChannels = channels; v.numFrames = frames;
    for (uint32_t c = 0; c < channels; ++c) v.ch[c] = data(c);
    return v;
  }
private:
  std::array<float, kMaxChannels * kMaxBlockSize> data_{};
};

}  // namespace pg
```

`engine/src/core/Event.hpp`:
```cpp
#pragma once
#include <array>
#include <cstdint>
#include <type_traits>
#include "core/Conventions.hpp"

namespace pg {

/// 0..63 core, 64..127 expression, 128+ user/plugin defined.
enum class EventType : uint16_t { NoteOn = 1, NoteOff = 2, NotePressure = 3, NoteExpression = 4, Trigger = 5 };

struct Event {
  uint32_t frame = 0;         // sample offset within the block
  EventType type = EventType::Trigger;
  uint8_t channel = 0;
  uint8_t flags = 0;
  uint32_t noteId = 0;        // per-note identity (MPE); 0 = none
  float a = 0.f, b = 0.f, c = 0.f;   // NoteOn: pitch (MIDI note), velocity 0..1, detune
};
static_assert(std::is_trivially_copyable_v<Event>);

/// Fixed capacity, frame-ordered. Producers must push in non-decreasing frame order.
class EventBuffer {
public:
  bool push(const Event& e) {
    if (count_ == kMaxEventsPerBlock) return false;
    if (count_ > 0 && e.frame < events_[count_ - 1].frame) return false;
    events_[count_++] = e;
    return true;
  }
  void clear() { count_ = 0; }
  uint32_t size() const { return count_; }
  const Event& operator[](uint32_t i) const { return events_[i]; }
  const Event* begin() const { return events_.data(); }
  const Event* end() const { return events_.data() + count_; }
private:
  std::array<Event, kMaxEventsPerBlock> events_{};
  uint32_t count_ = 0;
};

/// Stable k-way merge by frame (earlier source wins ties). Clears dst first. RT-safe.
void mergeEvents(const EventBuffer* const* sources, uint32_t numSources, EventBuffer& dst);

}  // namespace pg
```

`engine/src/core/Event.cpp`:
```cpp
#include "core/Event.hpp"

namespace pg {

void mergeEvents(const EventBuffer* const* sources, uint32_t numSources, EventBuffer& dst) {
  dst.clear();
  std::array<uint32_t, kMaxPortsPerModule> heads{};
  const uint32_t n = numSources < kMaxPortsPerModule ? numSources : kMaxPortsPerModule;
  for (;;) {
    int best = -1;
    uint32_t bestFrame = 0;
    for (uint32_t s = 0; s < n; ++s) {
      if (heads[s] >= sources[s]->size()) continue;
      const uint32_t f = (*sources[s])[heads[s]].frame;
      if (best < 0 || f < bestFrame) { best = static_cast<int>(s); bestFrame = f; }
    }
    if (best < 0) return;
    if (!dst.push((*sources[best])[heads[best]])) return;
    ++heads[best];
  }
}

}  // namespace pg
```

- [ ] **Step 4: Run the tests**

Run: `npm run engine:test` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add engine
git commit -m "feat(engine): conventions, planar signal views, event buffers"
```

---

### Task 7: Descriptors and parameters

**Files:**
- Create: `engine/src/core/Descriptor.hpp`, `engine/src/core/Param.hpp`, `engine/src/core/Param.cpp`
- Test: `engine/tests/test_param.cpp`

**Interfaces:**
- Produces: `pg::PortKind {Continuous, Event}`, `pg::SignalRole`, `pg::ParamUnit`, `pg::ParamCurve {Linear, Log, Exp}`, flags `kParamModulatable=1, kParamInteger=2, kParamEnum=4, kParamHidden=8, kParamNoSmooth=16`, module flags `kModuleTerminal=1, kModuleNeedsTransport=2, kModuleWritesTelemetry=4`, `pg::PortDesc`, `pg::ParamDesc`, `pg::ModuleDescriptor` (with `Module* (*create)()`), `kModuleAbiVersion = 1`, `countOf(array)`.
- `float pg::paramNormalize(const ParamDesc&, float value)`, `float pg::paramDenormalize(const ParamDesc&, float norm)` (both clamp).
- `pg::OnePoleSmoother { prepare(sampleRate, ms); snap(v); setTarget(t); isMoving(); next(); value(); }`
- `pg::ParamState { void prepare(const ParamDesc*, double sr, float initialNorm); void setTargetNorm(float); void fillRamp(uint32_t frames); bool rampIsConstant; float constNorm, constValue; std::array<float,kMaxBlockSize> rampNorm, rampValue; const ParamDesc* desc; }`

- [ ] **Step 1: Write the failing tests**

`engine/tests/test_param.cpp`:
```cpp
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include "core/Descriptor.hpp"
#include "core/Param.hpp"

static pg::ParamDesc lin{"g", "Gain", 0.f, 2.f, 1.f, pg::ParamUnit::Ratio, pg::ParamCurve::Linear, pg::kParamModulatable, nullptr, 0, "slider", nullptr, nullptr};
static pg::ParamDesc logp{"c", "Cutoff", 20.f, 20000.f, 1000.f, pg::ParamUnit::Hz, pg::ParamCurve::Log, pg::kParamModulatable, nullptr, 0, "slider", nullptr, nullptr};
static const char* kModes[] = {"LP", "HP", "BP"};
static pg::ParamDesc en{"m", "Mode", 0.f, 2.f, 0.f, pg::ParamUnit::None, pg::ParamCurve::Linear, pg::kParamEnum | pg::kParamInteger | pg::kParamNoSmooth, kModes, 3, "select", nullptr, nullptr};

TEST_CASE("param curves round-trip and clamp", "[param]") {
  REQUIRE(pg::paramDenormalize(lin, 0.5f) == Catch::Approx(1.f));
  REQUIRE(pg::paramNormalize(lin, 2.f) == Catch::Approx(1.f));
  REQUIRE(pg::paramNormalize(lin, 5.f) == Catch::Approx(1.f));           // clamped
  REQUIRE(pg::paramDenormalize(logp, 0.f) == Catch::Approx(20.f));
  REQUIRE(pg::paramDenormalize(logp, 1.f) == Catch::Approx(20000.f));
  REQUIRE(pg::paramNormalize(logp, pg::paramDenormalize(logp, 0.3f)) == Catch::Approx(0.3f).epsilon(1e-4));
  REQUIRE(pg::paramDenormalize(en, 0.74f) == Catch::Approx(1.f));          // rounds to integer
  REQUIRE(pg::paramDenormalize(en, 0.76f) == Catch::Approx(2.f));
}

TEST_CASE("smoother ramps toward target and reports movement", "[param]") {
  pg::OnePoleSmoother s;
  s.prepare(48000.0, 5.f);
  s.snap(0.f);
  REQUIRE_FALSE(s.isMoving());
  s.setTarget(1.f);
  REQUIRE(s.isMoving());
  float last = 0.f;
  for (int i = 0; i < 48000; ++i) { const float v = s.next(); REQUIRE(v >= last); last = v; }
  REQUIRE(last == Catch::Approx(1.f).margin(1e-5));
  REQUIRE_FALSE(s.isMoving());
}

TEST_CASE("ParamState produces constants when idle and ramps when moving", "[param]") {
  pg::ParamState p;
  p.prepare(&lin, 48000.0, 0.5f);
  p.fillRamp(64);
  REQUIRE(p.rampIsConstant);
  REQUIRE(p.constValue == Catch::Approx(1.f));
  p.setTargetNorm(1.f);
  p.fillRamp(64);
  REQUIRE_FALSE(p.rampIsConstant);
  REQUIRE(p.rampValue[63] > p.rampValue[0]);
  REQUIRE(p.rampValue[63] <= 2.f);
  pg::ParamState e;
  e.prepare(&en, 48000.0, 0.f);
  e.setTargetNorm(1.f);
  e.fillRamp(64);
  REQUIRE(e.rampIsConstant);              // kParamNoSmooth jumps at block boundary
  REQUIRE(e.constValue == Catch::Approx(2.f));
}
```

- [ ] **Step 2: Run to verify failure** — `npm run engine:test` fails to compile.

- [ ] **Step 3: Write Descriptor.hpp**

```cpp
#pragma once
#include <cstddef>
#include <cstdint>

namespace pg {

inline constexpr uint32_t kModuleAbiVersion = 1;

enum class PortKind : uint8_t { Continuous = 0, Event = 1 };
enum class SignalRole : uint8_t { Any = 0, Audio, Cv, Gate, Pitch, Phase };
enum class ParamUnit : uint8_t { None = 0, Hz, Seconds, Db, Semitones, Percent, Ratio };
enum class ParamCurve : uint8_t { Linear = 0, Log, Exp };

inline constexpr uint32_t kParamModulatable = 1u << 0;
inline constexpr uint32_t kParamInteger     = 1u << 1;
inline constexpr uint32_t kParamEnum        = 1u << 2;
inline constexpr uint32_t kParamHidden      = 1u << 3;
inline constexpr uint32_t kParamNoSmooth    = 1u << 4;

inline constexpr uint32_t kModuleTerminal        = 1u << 0;
inline constexpr uint32_t kModuleNeedsTransport  = 1u << 1;
inline constexpr uint32_t kModuleWritesTelemetry = 1u << 2;

// All descriptor structs are C-layout so they can cross a dlopen boundary unchanged.
struct PortDesc {
  const char* id;
  const char* name;
  PortKind kind;
  uint8_t channels;     // 1 or 2 for Continuous, 0 for Event
  SignalRole role;      // UI coloring hint only
  const char* doc;
};

struct ParamDesc {
  const char* id;
  const char* name;
  float min, max, def;  // in display units
  ParamUnit unit;
  ParamCurve curve;
  uint32_t flags;
  const char* const* enumLabels;   // kParamEnum only
  uint32_t enumCount;
  const char* uiWidget;            // "slider" | "knob" | "toggle" | "select"
  const char* group;               // optional
  const char* doc;                 // optional
};

class Module;

struct ModuleDescriptor {
  uint32_t abiVersion;
  const char* id;          // "osc.saw"
  const char* name;
  const char* category;
  const char* doc;
  const PortDesc* inputs;  uint32_t numInputs;
  const PortDesc* outputs; uint32_t numOutputs;
  const ParamDesc* params; uint32_t numParams;
  uint32_t flags;
  uint32_t telemetrySlots;
  Module* (*create)();
};

template <class T, size_t N>
constexpr uint32_t countOf(const T (&)[N]) { return static_cast<uint32_t>(N); }

}  // namespace pg
```

- [ ] **Step 4: Write Param.hpp / Param.cpp**

`engine/src/core/Param.hpp`:
```cpp
#pragma once
#include <array>
#include <cmath>
#include "core/Conventions.hpp"
#include "core/Descriptor.hpp"

namespace pg {

float paramNormalize(const ParamDesc& d, float value);
float paramDenormalize(const ParamDesc& d, float norm);

class OnePoleSmoother {
public:
  void prepare(double sampleRate, float ms) {
    const double samples = sampleRate * ms / 1000.0;
    coeff_ = samples > 0 ? static_cast<float>(std::exp(-1.0 / samples)) : 0.f;
  }
  void snap(float v) { value_ = target_ = v; }
  void setTarget(float t) { target_ = t; }
  bool isMoving() const { return std::fabs(value_ - target_) > 1e-6f; }
  float next() {
    value_ = target_ + coeff_ * (value_ - target_);
    if (!isMoving()) value_ = target_;
    return value_;
  }
  float value() const { return value_; }
private:
  float value_ = 0.f, target_ = 0.f, coeff_ = 0.f;
};

/// Per-instance (not per-voice) parameter state. Survives program swaps.
struct ParamState {
  const ParamDesc* desc = nullptr;
  OnePoleSmoother smoother;
  float target = 0.f;                 // normalized
  bool noSmooth = false;
  bool rampIsConstant = true;
  float constNorm = 0.f, constValue = 0.f;
  std::array<float, kMaxBlockSize> rampNorm{}, rampValue{};

  void prepare(const ParamDesc* d, double sampleRate, float initialNorm);
  void setTargetNorm(float norm);      // audio thread (via param queue) or before publish
  void fillRamp(uint32_t frames);      // audio thread, once per block
};

}  // namespace pg
```

`engine/src/core/Param.cpp`:
```cpp
#include "core/Param.hpp"
#include <algorithm>

namespace pg {

static float clamp01(float v) { return std::min(1.f, std::max(0.f, v)); }

float paramDenormalize(const ParamDesc& d, float norm) {
  const float n = clamp01(norm);
  float v;
  switch (d.curve) {
    case ParamCurve::Log:    v = d.min * std::pow(d.max / d.min, n); break;
    case ParamCurve::Exp:    v = d.min + (d.max - d.min) * n * n; break;
    case ParamCurve::Linear: v = d.min + (d.max - d.min) * n; break;
  }
  if (d.flags & (kParamInteger | kParamEnum)) v = std::round(v);
  return std::min(d.max, std::max(d.min, v));
}

float paramNormalize(const ParamDesc& d, float value) {
  const float v = std::min(d.max, std::max(d.min, value));
  switch (d.curve) {
    case ParamCurve::Log:    return clamp01(std::log(v / d.min) / std::log(d.max / d.min));
    case ParamCurve::Exp:    return clamp01(std::sqrt((v - d.min) / (d.max - d.min)));
    case ParamCurve::Linear: return clamp01((v - d.min) / (d.max - d.min));
  }
  return 0.f;
}

void ParamState::prepare(const ParamDesc* d, double sampleRate, float initialNorm) {
  desc = d;
  noSmooth = (d->flags & kParamNoSmooth) != 0;
  smoother.prepare(sampleRate, 5.f);
  target = clamp01(initialNorm);
  smoother.snap(target);
  rampIsConstant = true;
  constNorm = target;
  constValue = paramDenormalize(*d, target);
}

void ParamState::setTargetNorm(float norm) {
  target = clamp01(norm);
  smoother.setTarget(target);
}

void ParamState::fillRamp(uint32_t frames) {
  if (noSmooth) { smoother.snap(target); }
  if (!smoother.isMoving()) {
    rampIsConstant = true;
    constNorm = smoother.value();
    constValue = paramDenormalize(*desc, constNorm);
    return;
  }
  rampIsConstant = false;
  for (uint32_t i = 0; i < frames; ++i) {
    rampNorm[i] = smoother.next();
    rampValue[i] = paramDenormalize(*desc, rampNorm[i]);
  }
}

}  // namespace pg
```

- [ ] **Step 5: Run the tests** — `npm run engine:test` passes.

- [ ] **Step 6: Commit**

```bash
git add engine
git commit -m "feat(engine): C-layout descriptors, param curves, smoothing"
```

---

### Task 8: Module interface, registry with implicit param ports, test modules

**Files:**
- Create: `engine/src/core/Module.hpp`, `engine/src/core/Registry.hpp`, `engine/src/core/Registry.cpp`
- Create: `engine/tests/modules/TestModules.hpp`, `engine/tests/modules/TestModules.cpp`
- Test: `engine/tests/test_registry.cpp`

**Interfaces:**
- Produces: `pg::PrepareInfo{sampleRate, maxBlock, voiceCount}`, `pg::TransportSnapshot{tempo, playing, ppq, samplePos}`, `pg::AudioBus{std::array<float*,kMaxChannels> ch; uint32_t channels, frames}`, `pg::ParamView{buf,k; at(i)}`, `pg::ProcessContext` (fields `numFrames, voice, sampleRate, transport, outputBus, inputs, outputs, eventInputs, eventOutputs, params`; methods `in(p), out(p), eventIn(p), eventOut(p), param(i)`), `pg::Module` (`prepare`, `reset`, `process`), `pg::VoicedModule<State>` (`st(ctx)`, `onPrepare`, `info()`).
- `pg::RegisteredModule { desc; inputs (declared + implicit); inputParam; findInput(id); findOutput(id); findParam(id); numDeclaredInputs() }`, `pg::Registry { std::optional<std::string> add(const ModuleDescriptor&); find(typeId); all(); }`. Implicit port id format: `param:<paramId>`.
- Test modules: `test.const` (out `out`; param `value` [-1,1] modulatable), `test.gain` (in `in`; out `out`; param `gain` [0,2] def 1 modulatable), `test.add` (in `a`,`b`; out `out`), `test.impulse` (out `out`: 1 at frame 0 of first block after prepare/reset), `test.sink` (in `in`; terminal; adds into bus ch 0 and 1), `test.eventGen` (event out `events`; params `frame` [0,255] int, `tag` [0,100] int), `test.eventTrace` (event in `events`; out `out`: `out[frame] += a`). `void pg::test::registerTestModules(Registry&)`.

- [ ] **Step 1: Write the failing registry test**

`engine/tests/test_registry.cpp`:
```cpp
#include <catch2/catch_test_macros.hpp>
#include "core/Registry.hpp"
#include "modules/TestModules.hpp"

TEST_CASE("registry derives implicit modulation ports", "[registry]") {
  pg::Registry reg;
  pg::test::registerTestModules(reg);
  const pg::RegisteredModule* gain = reg.find("test.gain");
  REQUIRE(gain != nullptr);
  REQUIRE(gain->numDeclaredInputs() == 1);
  REQUIRE(gain->inputs.size() == 2);
  REQUIRE(gain->findInput("in") == 0);
  REQUIRE(gain->findInput("param:gain") == 1);
  REQUIRE(gain->inputParam[1] == 0);
  REQUIRE(gain->inputs[1].kind == pg::PortKind::Continuous);
  REQUIRE(gain->findOutput("out") == 0);
  REQUIRE(gain->findParam("gain") == 0);
  REQUIRE(gain->findInput("nope") == -1);
  REQUIRE(reg.find("test.eventGen")->inputs.empty());   // int params are not modulatable
}

TEST_CASE("registry rejects invalid descriptors", "[registry]") {
  pg::Registry reg;
  pg::test::registerTestModules(reg);
  static pg::ParamDesc badLog{"c", "C", 0.f, 10.f, 1.f, pg::ParamUnit::Hz, pg::ParamCurve::Log, 0, nullptr, 0, "slider", nullptr, nullptr};
  static pg::ModuleDescriptor bad{pg::kModuleAbiVersion, "test.bad", "Bad", "test", "", nullptr, 0, nullptr, 0, &badLog, 1, 0, 0, nullptr};
  REQUIRE(reg.add(bad).has_value());                       // Log curve with min == 0
  static pg::ModuleDescriptor dup{pg::kModuleAbiVersion, "test.gain", "Dup", "test", "", nullptr, 0, nullptr, 0, nullptr, 0, 0, 0, nullptr};
  REQUIRE(reg.add(dup).has_value());                       // duplicate id
}
```

- [ ] **Step 2: Write Module.hpp**

```cpp
#pragma once
#include <array>
#include <cstdint>
#include <vector>
#include "core/Conventions.hpp"
#include "core/Descriptor.hpp"
#include "core/Event.hpp"
#include "core/Signal.hpp"

namespace pg {

struct PrepareInfo {
  double sampleRate = 48000.0;
  uint32_t maxBlock = kMaxBlockSize;
  uint32_t voiceCount = 1;
  bool operator==(const PrepareInfo&) const = default;
};

struct TransportSnapshot {
  double tempo = 120.0;
  bool playing = false;
  double ppq = 0.0;          // quarter notes at block start
  uint64_t samplePos = 0;    // absolute sample position at block start
};

/// Engine output bus for the current block. Terminal modules ADD into it.
struct AudioBus {
  std::array<float*, kMaxChannels> ch{};
  uint32_t channels = 2;
  uint32_t frames = 0;
};

struct ParamView {
  const float* buf = nullptr;   // per-sample values in display units, or null
  float k = 0.f;                // constant value when buf is null
  float at(uint32_t i) const { return buf ? buf[i] : k; }
};

struct TelemetrySlot;  // phase 5

/// Built by the scheduler per Process op. Port indices are the descriptor's declared indices.
struct ProcessContext {
  uint32_t numFrames = 0;
  uint32_t voice = 0;
  double sampleRate = 48000.0;
  const TransportSnapshot* transport = nullptr;
  AudioBus* outputBus = nullptr;
  const SignalView* inputs = nullptr;               // [numDeclaredInputs]; empty view for event ports
  const SignalView* outputs = nullptr;              // [numOutputs]
  const EventBuffer* const* eventInputs = nullptr;  // [numDeclaredInputs]; null for continuous ports
  EventBuffer* const* eventOutputs = nullptr;       // [numOutputs]
  const ParamView* params = nullptr;                // [numParams]

  const SignalView& in(uint32_t p) const { return inputs[p]; }
  const SignalView& out(uint32_t p) const { return outputs[p]; }
  const EventBuffer& eventIn(uint32_t p) const { return *eventInputs[p]; }
  EventBuffer& eventOut(uint32_t p) const { return *eventOutputs[p]; }
  ParamView param(uint32_t i) const { return params[i]; }
};

class Module {
public:
  virtual ~Module() = default;
  virtual void prepare(const PrepareInfo&) = 0;   // message thread; the only place to allocate
  virtual void reset(uint32_t /*voice*/) {}
  virtual void process(ProcessContext&) = 0;      // audio thread; no alloc/lock/IO/exceptions
};

/// Keeps all mutable DSP state in a per-voice State struct.
template <class State>
class VoicedModule : public Module {
public:
  void prepare(const PrepareInfo& p) final {
    states_.assign(p.voiceCount, State{});
    info_ = p;
    onPrepare(p);
  }
  void reset(uint32_t voice) override { states_[voice] = State{}; }
protected:
  virtual void onPrepare(const PrepareInfo&) {}
  State& st(const ProcessContext& c) { return states_[c.voice]; }
  const PrepareInfo& info() const { return info_; }
private:
  std::vector<State> states_;
  PrepareInfo info_{};
};

}  // namespace pg
```

- [ ] **Step 3: Write Registry.hpp / Registry.cpp**

`engine/src/core/Registry.hpp`:
```cpp
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
  /// Returns an error message on rejection.
  std::optional<std::string> add(const ModuleDescriptor& desc);
  const RegisteredModule* find(std::string_view typeId) const;
  std::vector<const RegisteredModule*> all() const;
private:
  std::map<std::string, std::unique_ptr<RegisteredModule>, std::less<>> byId_;
};

}  // namespace pg
```

`engine/src/core/Registry.cpp`:
```cpp
#include "core/Registry.hpp"
#include <set>
#include "core/Conventions.hpp"

namespace pg {

int32_t RegisteredModule::findInput(std::string_view id) const {
  for (size_t i = 0; i < inputs.size(); ++i) if (id == inputs[i].id) return static_cast<int32_t>(i);
  return -1;
}
int32_t RegisteredModule::findOutput(std::string_view id) const {
  for (uint32_t i = 0; i < desc->numOutputs; ++i) if (id == desc->outputs[i].id) return static_cast<int32_t>(i);
  return -1;
}
int32_t RegisteredModule::findParam(std::string_view id) const {
  for (uint32_t i = 0; i < desc->numParams; ++i) if (id == desc->params[i].id) return static_cast<int32_t>(i);
  return -1;
}

std::optional<std::string> Registry::add(const ModuleDescriptor& d) {
  const std::string id = d.id ? d.id : "";
  if (id.empty()) return "descriptor has no id";
  if (d.abiVersion != kModuleAbiVersion) return id + ": abi version mismatch";
  if (byId_.contains(id)) return id + ": duplicate module id";
  if (d.numInputs + d.numParams > kMaxPortsPerModule || d.numOutputs > kMaxPortsPerModule) return id + ": too many ports";
  if (d.numParams > kMaxParamsPerModule) return id + ": too many params";
  if (!d.create) return id + ": missing create()";

  std::set<std::string> ids;
  for (uint32_t i = 0; i < d.numInputs; ++i) {
    if (!ids.insert(d.inputs[i].id).second) return id + ": duplicate input id " + d.inputs[i].id;
    if (d.inputs[i].kind == PortKind::Continuous && (d.inputs[i].channels < 1 || d.inputs[i].channels > kMaxChannels))
      return id + ": bad channel count on input " + d.inputs[i].id;
  }
  ids.clear();
  for (uint32_t i = 0; i < d.numOutputs; ++i)
    if (!ids.insert(d.outputs[i].id).second) return id + ": duplicate output id " + d.outputs[i].id;
  ids.clear();
  for (uint32_t i = 0; i < d.numParams; ++i) {
    const ParamDesc& p = d.params[i];
    if (!ids.insert(p.id).second) return id + ": duplicate param id " + p.id;
    if (!(p.min < p.max)) return id + ": param " + p.id + " needs min < max";
    if (p.curve == ParamCurve::Log && p.min <= 0.f) return id + ": log param " + p.id + " needs min > 0";
    if ((p.flags & kParamEnum) && (p.enumLabels == nullptr || p.enumCount == 0)) return id + ": enum param " + p.id + " has no labels";
    if (p.flags & kParamModulatable) {
      const std::string implicitId = "param:" + std::string(p.id);
      for (uint32_t k = 0; k < d.numInputs; ++k) if (implicitId == d.inputs[k].id) return id + ": input collides with implicit port " + implicitId;
    }
  }

  auto rm = std::make_unique<RegisteredModule>();
  rm->desc = &d;
  for (uint32_t i = 0; i < d.numInputs; ++i) { rm->inputs.push_back(d.inputs[i]); rm->inputParam.push_back(-1); }
  for (uint32_t i = 0; i < d.numParams; ++i) {
    const ParamDesc& p = d.params[i];
    if (!(p.flags & kParamModulatable) || (p.flags & (kParamInteger | kParamEnum))) continue;
    rm->implicitIds.push_back("param:" + std::string(p.id));
    rm->inputs.push_back(PortDesc{rm->implicitIds.back().c_str(), p.name, PortKind::Continuous, 1, SignalRole::Cv, p.doc});
    rm->inputParam.push_back(static_cast<int32_t>(i));
  }
  byId_.emplace(id, std::move(rm));
  return std::nullopt;
}

const RegisteredModule* Registry::find(std::string_view typeId) const {
  auto it = byId_.find(typeId);
  return it == byId_.end() ? nullptr : it->second.get();
}

std::vector<const RegisteredModule*> Registry::all() const {
  std::vector<const RegisteredModule*> out;
  for (const auto& [k, v] : byId_) out.push_back(v.get());
  return out;
}

}  // namespace pg
```

- [ ] **Step 4: Write the test modules**

`engine/tests/modules/TestModules.hpp`:
```cpp
#pragma once
#include "core/Registry.hpp"

namespace pg::test {
/// Registers test.const, test.gain, test.add, test.impulse, test.sink, test.eventGen, test.eventTrace.
void registerTestModules(Registry& registry);
}
```

`engine/tests/modules/TestModules.cpp`:
```cpp
#include "modules/TestModules.hpp"
#include "core/Module.hpp"

namespace pg::test {
namespace {

// ---- test.const
const PortDesc kConstOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Cv, ""}};
const ParamDesc kConstParams[] = {{"value", "Value", -1.f, 1.f, 0.f, ParamUnit::None, ParamCurve::Linear, kParamModulatable, nullptr, 0, "slider", nullptr, ""}};
class Const : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    const ParamView v = c.param(0);
    float* o = c.out(0).write(0);
    for (uint32_t i = 0; i < c.numFrames; ++i) o[i] = v.at(i);
  }
};
const ModuleDescriptor kConst{kModuleAbiVersion, "test.const", "Const", "test", "", nullptr, 0, kConstOut, 1, kConstParams, 1, 0, 0, [] () -> Module* { return new Const(); }};

// ---- test.gain
const PortDesc kGainIn[] = {{"in", "In", PortKind::Continuous, 1, SignalRole::Any, ""}};
const PortDesc kGainOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Any, ""}};
const ParamDesc kGainParams[] = {{"gain", "Gain", 0.f, 2.f, 1.f, ParamUnit::Ratio, ParamCurve::Linear, kParamModulatable, nullptr, 0, "slider", nullptr, ""}};
class Gain : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    const float* in = c.in(0).read(0); float* o = c.out(0).write(0); const ParamView g = c.param(0);
    for (uint32_t i = 0; i < c.numFrames; ++i) o[i] = in[i] * g.at(i);
  }
};
const ModuleDescriptor kGain{kModuleAbiVersion, "test.gain", "Gain", "test", "", kGainIn, 1, kGainOut, 1, kGainParams, 1, 0, 0, [] () -> Module* { return new Gain(); }};

// ---- test.add
const PortDesc kAddIn[] = {{"a", "A", PortKind::Continuous, 1, SignalRole::Any, ""}, {"b", "B", PortKind::Continuous, 1, SignalRole::Any, ""}};
const PortDesc kAddOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Any, ""}};
class Add : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    const float* a = c.in(0).read(0); const float* b = c.in(1).read(0); float* o = c.out(0).write(0);
    for (uint32_t i = 0; i < c.numFrames; ++i) o[i] = a[i] + b[i];
  }
};
const ModuleDescriptor kAdd{kModuleAbiVersion, "test.add", "Add", "test", "", kAddIn, 2, kAddOut, 1, nullptr, 0, 0, 0, [] () -> Module* { return new Add(); }};

// ---- test.impulse: 1.0 at the first frame after prepare/reset, then 0.
struct ImpulseState { bool fired = false; };
const PortDesc kImpulseOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Gate, ""}};
class Impulse : public VoicedModule<ImpulseState> {
  void process(ProcessContext& c) override {
    float* o = c.out(0).write(0);
    for (uint32_t i = 0; i < c.numFrames; ++i) o[i] = 0.f;
    if (!st(c).fired) { o[0] = 1.f; st(c).fired = true; }
  }
};
const ModuleDescriptor kImpulse{kModuleAbiVersion, "test.impulse", "Impulse", "test", "", nullptr, 0, kImpulseOut, 1, nullptr, 0, 0, 0, [] () -> Module* { return new Impulse(); }};

// ---- test.sink: terminal; adds input into both bus channels.
const PortDesc kSinkIn[] = {{"in", "In", PortKind::Continuous, 1, SignalRole::Audio, ""}};
class Sink : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    const float* in = c.in(0).read(0);
    for (uint32_t ch = 0; ch < c.outputBus->channels; ++ch)
      for (uint32_t i = 0; i < c.numFrames; ++i) c.outputBus->ch[ch][i] += in[i];
  }
};
const ModuleDescriptor kSink{kModuleAbiVersion, "test.sink", "Sink", "test", "", kSinkIn, 1, nullptr, 0, nullptr, 0, kModuleTerminal, 0, [] () -> Module* { return new Sink(); }};

// ---- test.eventGen: one Trigger per block at `frame`, payload a = tag.
const PortDesc kEvGenOut[] = {{"events", "Events", PortKind::Event, 0, SignalRole::Any, ""}};
const ParamDesc kEvGenParams[] = {
  {"frame", "Frame", 0.f, 255.f, 0.f, ParamUnit::None, ParamCurve::Linear, kParamInteger | kParamNoSmooth, nullptr, 0, "slider", nullptr, ""},
  {"tag", "Tag", 0.f, 100.f, 1.f, ParamUnit::None, ParamCurve::Linear, kParamInteger | kParamNoSmooth, nullptr, 0, "slider", nullptr, ""}};
class EventGen : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    const uint32_t frame = static_cast<uint32_t>(c.param(0).at(0));
    if (frame >= c.numFrames) return;
    Event e; e.frame = frame; e.type = EventType::Trigger; e.a = c.param(1).at(0);
    c.eventOut(0).push(e);
  }
};
const ModuleDescriptor kEventGen{kModuleAbiVersion, "test.eventGen", "EventGen", "test", "", nullptr, 0, kEvGenOut, 1, kEvGenParams, 2, 0, 0, [] () -> Module* { return new EventGen(); }};

// ---- test.eventTrace: out[e.frame] += e.a
const PortDesc kEvTraceIn[] = {{"events", "Events", PortKind::Event, 0, SignalRole::Any, ""}};
const PortDesc kEvTraceOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Cv, ""}};
class EventTrace : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    float* o = c.out(0).write(0);
    for (uint32_t i = 0; i < c.numFrames; ++i) o[i] = 0.f;
    for (const Event& e : c.eventIn(0)) if (e.frame < c.numFrames) o[e.frame] += e.a;
  }
};
const ModuleDescriptor kEventTrace{kModuleAbiVersion, "test.eventTrace", "EventTrace", "test", "", kEvTraceIn, 1, kEvTraceOut, 1, nullptr, 0, 0, 0, [] () -> Module* { return new EventTrace(); }};

}  // namespace

void registerTestModules(Registry& r) {
  for (const ModuleDescriptor* d : {&kConst, &kGain, &kAdd, &kImpulse, &kSink, &kEventGen, &kEventTrace})
    if (auto err = r.add(*d)) throw std::runtime_error(*err);
}

}  // namespace pg::test
```
(Add `#include <stdexcept>` at the top.)

- [ ] **Step 5: Run the tests** — `npm run engine:test` passes (registry tests + earlier suites).

- [ ] **Step 6: Commit**

```bash
git add engine
git commit -m "feat(engine): module interface, registry with implicit param ports, test modules"
```

---

### Task 9: GraphModel with validation

**Files:**
- Create: `engine/src/core/Result.hpp`, `engine/src/core/GraphModel.hpp`, `engine/src/core/GraphModel.cpp`
- Test: `engine/tests/test_graph_model.cpp`

**Interfaces:**
- Produces: `pg::Result { bool ok; std::string code, message; static Result fail(code, message); explicit operator bool() }`, `pg::FeedbackMode {Sample, Block}`, `pg::NodeModel { id, type, std::map<std::string,float> params }` (param values in display units), `pg::EdgeModel { id, fromNode, fromPort, toNode, toPort }`, `pg::GraphModel { addNode(reg, NodeModel); removeNode(id); addEdge(reg, EdgeModel); removeEdge(id); setParam(reg, node, param, value); clear(); nodes(); edges(); uint32_t voiceCount; FeedbackMode feedbackMode; }`.
- Error codes: `E_DUP_ID`, `E_UNKNOWN_TYPE`, `E_NODE_NOT_FOUND`, `E_PORT_NOT_FOUND`, `E_KIND_MISMATCH`, `E_EDGE_NOT_FOUND`, `E_PARAM_NOT_FOUND`, `E_DUP_EDGE`, `E_VOICES`.

- [ ] **Step 1: Write the failing test**

`engine/tests/test_graph_model.cpp`:
```cpp
#include <catch2/catch_test_macros.hpp>
#include "core/GraphModel.hpp"
#include "modules/TestModules.hpp"

static pg::Registry& reg() { static pg::Registry r; static bool init = (pg::test::registerTestModules(r), true); (void)init; return r; }

TEST_CASE("GraphModel validates nodes, edges and params", "[model]") {
  pg::GraphModel m;
  REQUIRE(m.addNode(reg(), {"c", "test.const", {{"value", 0.5f}}}));
  REQUIRE(m.addNode(reg(), {"g", "test.gain", {}}));
  REQUIRE(m.addNode(reg(), {"c", "test.const", {}}).code == "E_DUP_ID");
  REQUIRE(m.addNode(reg(), {"x", "nope.type", {}}).code == "E_UNKNOWN_TYPE");
  REQUIRE(m.addNode(reg(), {"y", "test.const", {{"bogus", 1.f}}}).code == "E_PARAM_NOT_FOUND");

  REQUIRE(m.addEdge(reg(), {"e1", "c", "out", "g", "in"}));
  REQUIRE(m.addEdge(reg(), {"e1", "c", "out", "g", "in"}).code == "E_DUP_ID");
  REQUIRE(m.addEdge(reg(), {"e2", "c", "out", "g", "in"}).code == "E_DUP_EDGE");
  REQUIRE(m.addEdge(reg(), {"e3", "c", "out", "g", "param:gain"}));   // implicit port is addressable
  REQUIRE(m.addEdge(reg(), {"e4", "c", "nope", "g", "in"}).code == "E_PORT_NOT_FOUND");
  REQUIRE(m.addEdge(reg(), {"e5", "zz", "out", "g", "in"}).code == "E_NODE_NOT_FOUND");

  REQUIRE(m.addNode(reg(), {"ev", "test.eventGen", {}}));
  REQUIRE(m.addEdge(reg(), {"e6", "ev", "events", "g", "in"}).code == "E_KIND_MISMATCH");

  REQUIRE(m.setParam(reg(), "g", "gain", 0.25f));
  REQUIRE(m.nodes().at("g").params.at("gain") == 0.25f);
  REQUIRE(m.setParam(reg(), "g", "nope", 1.f).code == "E_PARAM_NOT_FOUND");

  REQUIRE(m.removeEdge("e3"));
  REQUIRE(m.removeEdge("e3").code == "E_EDGE_NOT_FOUND");
  REQUIRE(m.removeNode("c"));                 // also drops e1
  REQUIRE(m.edges().count("e1") == 0);
  REQUIRE(m.removeNode("c").code == "E_NODE_NOT_FOUND");
}
```

- [ ] **Step 2: Run to verify failure** — `npm run engine:test` fails to compile.

- [ ] **Step 3: Write the model**

`engine/src/core/Result.hpp`:
```cpp
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
```

`engine/src/core/GraphModel.hpp`:
```cpp
#pragma once
#include <map>
#include <string>
#include "core/Registry.hpp"
#include "core/Result.hpp"

namespace pg {

enum class FeedbackMode { Sample, Block };

struct NodeModel {
  std::string id;
  std::string type;
  std::map<std::string, float> params;   // display units; missing = descriptor default
};

struct EdgeModel {
  std::string id;
  std::string fromNode, fromPort, toNode, toPort;
};

/// Engine-side mirror of the frontend's patch document. Message thread only.
class GraphModel {
public:
  Result addNode(const Registry& reg, NodeModel node);
  Result removeNode(const std::string& id);
  Result addEdge(const Registry& reg, EdgeModel edge);
  Result removeEdge(const std::string& id);
  Result setParam(const Registry& reg, const std::string& node, const std::string& param, float value);
  Result setVoiceCount(uint32_t n);
  void clear();

  const std::map<std::string, NodeModel>& nodes() const { return nodes_; }
  const std::map<std::string, EdgeModel>& edges() const { return edges_; }
  uint32_t voiceCount = 1;
  FeedbackMode feedbackMode = FeedbackMode::Sample;

private:
  std::map<std::string, NodeModel> nodes_;
  std::map<std::string, EdgeModel> edges_;
};

}  // namespace pg
```

`engine/src/core/GraphModel.cpp`:
```cpp
#include "core/GraphModel.hpp"

namespace pg {

Result GraphModel::addNode(const Registry& reg, NodeModel node) {
  if (nodes_.contains(node.id)) return Result::fail("E_DUP_ID", "node exists: " + node.id);
  const RegisteredModule* type = reg.find(node.type);
  if (!type) return Result::fail("E_UNKNOWN_TYPE", "unknown module type: " + node.type);
  for (const auto& [k, v] : node.params)
    if (type->findParam(k) < 0) return Result::fail("E_PARAM_NOT_FOUND", node.type + " has no param " + k);
  nodes_.emplace(node.id, std::move(node));
  return {};
}

Result GraphModel::removeNode(const std::string& id) {
  if (!nodes_.erase(id)) return Result::fail("E_NODE_NOT_FOUND", "no node " + id);
  for (auto it = edges_.begin(); it != edges_.end();)
    it = (it->second.fromNode == id || it->second.toNode == id) ? edges_.erase(it) : std::next(it);
  return {};
}

Result GraphModel::addEdge(const Registry& reg, EdgeModel e) {
  if (edges_.contains(e.id)) return Result::fail("E_DUP_ID", "edge exists: " + e.id);
  auto from = nodes_.find(e.fromNode);
  if (from == nodes_.end()) return Result::fail("E_NODE_NOT_FOUND", "no node " + e.fromNode);
  auto to = nodes_.find(e.toNode);
  if (to == nodes_.end()) return Result::fail("E_NODE_NOT_FOUND", "no node " + e.toNode);
  const RegisteredModule* ft = reg.find(from->second.type);
  const RegisteredModule* tt = reg.find(to->second.type);
  const int32_t op = ft->findOutput(e.fromPort);
  if (op < 0) return Result::fail("E_PORT_NOT_FOUND", e.fromNode + " has no output " + e.fromPort);
  const int32_t ip = tt->findInput(e.toPort);
  if (ip < 0) return Result::fail("E_PORT_NOT_FOUND", e.toNode + " has no input " + e.toPort);
  if (ft->desc->outputs[op].kind != tt->inputs[ip].kind) return Result::fail("E_KIND_MISMATCH", "port kinds differ");
  for (const auto& [k, other] : edges_)
    if (other.fromNode == e.fromNode && other.fromPort == e.fromPort && other.toNode == e.toNode && other.toPort == e.toPort)
      return Result::fail("E_DUP_EDGE", "connection already exists: " + k);
  edges_.emplace(e.id, std::move(e));
  return {};
}

Result GraphModel::removeEdge(const std::string& id) {
  if (!edges_.erase(id)) return Result::fail("E_EDGE_NOT_FOUND", "no edge " + id);
  return {};
}

Result GraphModel::setParam(const Registry& reg, const std::string& node, const std::string& param, float value) {
  auto it = nodes_.find(node);
  if (it == nodes_.end()) return Result::fail("E_NODE_NOT_FOUND", "no node " + node);
  if (reg.find(it->second.type)->findParam(param) < 0) return Result::fail("E_PARAM_NOT_FOUND", node + " has no param " + param);
  it->second.params[param] = value;
  return {};
}

Result GraphModel::setVoiceCount(uint32_t n) {
  if (n < 1 || n > 64) return Result::fail("E_VOICES", "voiceCount must be 1..64");
  voiceCount = n;
  return {};
}

void GraphModel::clear() { nodes_.clear(); edges_.clear(); voiceCount = 1; feedbackMode = FeedbackMode::Sample; }

}  // namespace pg
```

- [ ] **Step 4: Run the tests** — `npm run engine:test` passes.

- [ ] **Step 5: Commit**

```bash
git add engine
git commit -m "feat(engine): GraphModel document mirror with validation"
```

---

### Task 10: Program, InstanceTable, Scheduler (executes hand-built programs)

**Files:**
- Create: `engine/src/core/Program.hpp`, `engine/src/core/InstanceTable.hpp`, `engine/src/core/InstanceTable.cpp`, `engine/src/core/Scheduler.hpp`, `engine/src/core/Scheduler.cpp`
- Test: `engine/tests/test_scheduler.cpp`

**Interfaces:**
- Produces: `pg::ModuleInstance { std::string id; uint64_t serial; const RegisteredModule* type; std::unique_ptr<Module> module; std::vector<ParamState> params; }`, `pg::FeedbackState { std::array<std::array<float,kMaxBlockSize>,kMaxChannels> z; uint32_t channels; }`, `pg::Op { Kind kind; uint32_t a,b,c; }` with kinds `Sum, Merge, FillParam, FeedbackRead, FeedbackWrite, ClearEvents, Process, ClusterBegin, ClusterEnd`, `pg::NodeSlot { inst; inBuf, outBuf, inEvt, outEvt, paramBuf (vectors of uint32_t) }`, `pg::Program { revision, voiceCount, blockSize, sampleRate, feedbackMode, nodes, buffers, bufferChannels, eventBufs, args, ops, feedback, serialIndex; findNodeBySerial(serial); allocBuffer(channels); allocEventBuffer(); }`, constants `kNone = UINT32_MAX`, `kSilentBuffer = 0`, `kEmptyEvents = 0`.
- Op operand meaning: `Sum{a=dst buffer, b=args start, c=count}`; `Merge{a=dst event buffer, b=args start, c=count}`; `FillParam{a=node, b=param index, c=modulation buffer}`; `FeedbackRead{a=feedback index, b=dst buffer}`; `FeedbackWrite{a=feedback index, b=src buffer}`; `ClearEvents{a=event buffer}`; `Process{a=node}`; `ClusterBegin{a=op count}`.
- `pg::InstanceTable { std::shared_ptr<ModuleInstance> acquire(id, const RegisteredModule&, const PrepareInfo&, const std::map<std::string,float>& params); std::shared_ptr<FeedbackState> acquireFeedback(edgeId, channels); void prune(const std::set<std::string>& liveNodeIds, const std::set<std::string>& liveEdgeIds); const ModuleInstance* find(id) const; size_t size() const; }`
- `pg::Scheduler::run(Program&, uint32_t numFrames, const TransportSnapshot&, AudioBus*)`.

- [ ] **Step 1: Write the failing test (hand-built program)**

`engine/tests/test_scheduler.cpp`:
```cpp
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include "core/InstanceTable.hpp"
#include "core/Program.hpp"
#include "core/Scheduler.hpp"
#include "modules/TestModules.hpp"

TEST_CASE("Scheduler runs a hand-built const -> gain program with a modulated param", "[scheduler]") {
  pg::Registry reg; pg::test::registerTestModules(reg);
  pg::InstanceTable table;
  pg::PrepareInfo info{48000.0, pg::kMaxBlockSize, 1};
  pg::Program p;
  p.allocBuffer(1);   // buffer 0 = silent
  p.allocEventBuffer();   // event buffer 0 = always empty

  // node 0: const value 0.5   node 1: gain knob 0.5 (norm 0.25) modulated by node 2: const 0.2
  pg::NodeSlot c; c.inst = table.acquire("c", *reg.find("test.const"), info, {{"value", 0.5f}});
  c.outBuf = {p.allocBuffer(1)}; c.outEvt = {pg::kNone}; c.paramBuf = {pg::kNone};
  pg::NodeSlot m; m.inst = table.acquire("m", *reg.find("test.const"), info, {{"value", 0.2f}});
  m.outBuf = {p.allocBuffer(1)}; m.outEvt = {pg::kNone}; m.paramBuf = {pg::kNone};
  pg::NodeSlot g; g.inst = table.acquire("g", *reg.find("test.gain"), info, {{"gain", 0.5f}});
  g.inBuf = {c.outBuf[0]}; g.inEvt = {pg::kNone}; g.outBuf = {p.allocBuffer(1)}; g.outEvt = {pg::kNone};
  g.paramBuf = {p.allocBuffer(1)};
  p.nodes = {c, m, g};
  p.ops = {
    pg::Op{pg::Op::Process, 0}, pg::Op{pg::Op::Process, 1},
    pg::Op{pg::Op::FillParam, 2, 0, m.outBuf[0]},
    pg::Op{pg::Op::Process, 2},
  };
  p.buildSerialIndex();

  pg::Scheduler s;
  pg::TransportSnapshot t;
  s.run(p, 64, t, nullptr);
  const float* out = p.buffers[g.outBuf[0]].data(0);
  // effective gain norm = 0.25 + 0.2 = 0.45 -> 0.9 ; 0.5 * 0.9 = 0.45
  REQUIRE(out[0] == Catch::Approx(0.45f));
  REQUIRE(out[63] == Catch::Approx(0.45f));
}

TEST_CASE("Scheduler sums fan-in and routes events", "[scheduler]") {
  pg::Registry reg; pg::test::registerTestModules(reg);
  pg::InstanceTable table;
  pg::PrepareInfo info{48000.0, pg::kMaxBlockSize, 1};
  pg::Program p;
  p.allocBuffer(1); p.allocEventBuffer();
  pg::NodeSlot a; a.inst = table.acquire("a", *reg.find("test.const"), info, {{"value", 0.25f}});
  a.outBuf = {p.allocBuffer(1)}; a.outEvt = {pg::kNone}; a.paramBuf = {pg::kNone};
  pg::NodeSlot b; b.inst = table.acquire("b", *reg.find("test.const"), info, {{"value", 0.5f}});
  b.outBuf = {p.allocBuffer(1)}; b.outEvt = {pg::kNone}; b.paramBuf = {pg::kNone};
  const uint32_t sum = p.allocBuffer(1);
  pg::NodeSlot g; g.inst = table.acquire("g", *reg.find("test.gain"), info, {});
  g.inBuf = {sum}; g.inEvt = {pg::kNone}; g.outBuf = {p.allocBuffer(1)}; g.outEvt = {pg::kNone}; g.paramBuf = {pg::kNone};
  pg::NodeSlot e1; e1.inst = table.acquire("e1", *reg.find("test.eventGen"), info, {{"frame", 3.f}, {"tag", 2.f}});
  e1.outBuf = {pg::kNone}; e1.outEvt = {p.allocEventBuffer()}; e1.paramBuf = {pg::kNone, pg::kNone};
  pg::NodeSlot e2; e2.inst = table.acquire("e2", *reg.find("test.eventGen"), info, {{"frame", 3.f}, {"tag", 5.f}});
  e2.outBuf = {pg::kNone}; e2.outEvt = {p.allocEventBuffer()}; e2.paramBuf = {pg::kNone, pg::kNone};
  const uint32_t merged = p.allocEventBuffer();
  pg::NodeSlot tr; tr.inst = table.acquire("tr", *reg.find("test.eventTrace"), info, {});
  tr.inBuf = {pg::kNone}; tr.inEvt = {merged}; tr.outBuf = {p.allocBuffer(1)}; tr.outEvt = {pg::kNone}; tr.paramBuf = {};
  p.nodes = {a, b, g, e1, e2, tr};
  p.args = {a.outBuf[0], b.outBuf[0], e1.outEvt[0], e2.outEvt[0]};
  p.ops = {
    pg::Op{pg::Op::Process, 0}, pg::Op{pg::Op::Process, 1},
    pg::Op{pg::Op::Sum, sum, 0, 2}, pg::Op{pg::Op::Process, 2},
    pg::Op{pg::Op::ClearEvents, e1.outEvt[0]}, pg::Op{pg::Op::Process, 3},
    pg::Op{pg::Op::ClearEvents, e2.outEvt[0]}, pg::Op{pg::Op::Process, 4},
    pg::Op{pg::Op::Merge, merged, 2, 2}, pg::Op{pg::Op::Process, 5},
  };
  p.buildSerialIndex();
  pg::Scheduler s; pg::TransportSnapshot t;
  s.run(p, 64, t, nullptr);
  REQUIRE(p.buffers[g.outBuf[0]].data(0)[10] == Catch::Approx(0.75f));
  const float* trace = p.buffers[tr.outBuf[0]].data(0);
  REQUIRE(trace[3] == Catch::Approx(7.f));
  REQUIRE(trace[2] == 0.f);
  s.run(p, 64, t, nullptr);                       // second block: events cleared and regenerated, not accumulated
  REQUIRE(trace[3] == Catch::Approx(7.f));
}
```

- [ ] **Step 2: Run to verify failure** — compile errors.

- [ ] **Step 3: Write Program.hpp**

```cpp
#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>
#include "core/Conventions.hpp"
#include "core/Event.hpp"
#include "core/GraphModel.hpp"
#include "core/Module.hpp"
#include "core/Param.hpp"
#include "core/Registry.hpp"
#include "core/Signal.hpp"

namespace pg {

inline constexpr uint32_t kNone = UINT32_MAX;
inline constexpr uint32_t kSilentBuffer = 0;   // buffers[0] is never written
inline constexpr uint32_t kEmptyEvents = 0;    // eventBufs[0] is never written

/// One per module id in the patch. Owned by InstanceTable, shared with every Program that uses it.
struct ModuleInstance {
  std::string id;
  uint64_t serial = 0;
  const RegisteredModule* type = nullptr;
  std::unique_ptr<Module> module;
  std::vector<ParamState> params;
};

/// Delay memory for one back edge. z[c][i] holds the last written frame(s).
struct FeedbackState {
  std::array<std::array<float, kMaxBlockSize>, kMaxChannels> z{};
  uint32_t channels = 1;
};

struct Op {
  enum Kind : uint8_t { Sum, Merge, FillParam, FeedbackRead, FeedbackWrite, ClearEvents, Process, ClusterBegin, ClusterEnd };
  Kind kind;
  uint32_t a = 0, b = 0, c = 0;
};

struct NodeSlot {
  std::shared_ptr<ModuleInstance> inst;
  std::vector<uint32_t> inBuf;     // per declared input: buffer index (kSilentBuffer if unconnected, kNone for event ports)
  std::vector<uint32_t> outBuf;    // per output: buffer index (kNone for event ports)
  std::vector<uint32_t> inEvt;     // per declared input: event buffer index (kNone for continuous ports)
  std::vector<uint32_t> outEvt;    // per output: event buffer index (kNone for continuous ports)
  std::vector<uint32_t> paramBuf;  // per param: buffer with per-sample values when modulated, else kNone
};

/// Immutable once published. Built on the message thread, executed on the audio thread.
struct Program {
  uint64_t revision = 0;
  uint32_t voiceCount = 1;
  uint32_t blockSize = kDefaultBlockSize;
  double sampleRate = 48000.0;
  FeedbackMode feedbackMode = FeedbackMode::Sample;

  std::vector<NodeSlot> nodes;
  std::vector<PlanarBuffer> buffers;
  std::vector<uint32_t> bufferChannels;
  std::vector<EventBuffer> eventBufs;
  std::vector<uint32_t> args;       // operand lists for Sum/Merge
  std::vector<Op> ops;
  std::vector<std::shared_ptr<FeedbackState>> feedback;
  std::vector<std::pair<uint64_t, uint32_t>> serialIndex;   // sorted (serial, node index)

  uint32_t allocBuffer(uint32_t channels) {
    buffers.emplace_back(); bufferChannels.push_back(channels);
    return static_cast<uint32_t>(buffers.size() - 1);
  }
  uint32_t allocEventBuffer() { eventBufs.emplace_back(); return static_cast<uint32_t>(eventBufs.size() - 1); }
  void buildSerialIndex() {
    serialIndex.clear();
    for (uint32_t i = 0; i < nodes.size(); ++i) serialIndex.emplace_back(nodes[i].inst->serial, i);
    std::sort(serialIndex.begin(), serialIndex.end());
  }
  int32_t findNodeBySerial(uint64_t serial) const {   // RT-safe binary search
    auto it = std::lower_bound(serialIndex.begin(), serialIndex.end(), std::make_pair(serial, uint32_t{0}));
    return (it != serialIndex.end() && it->first == serial) ? static_cast<int32_t>(it->second) : -1;
  }
};

}  // namespace pg
```

- [ ] **Step 4: Write InstanceTable**

`engine/src/core/InstanceTable.hpp`:
```cpp
#pragma once
#include <map>
#include <memory>
#include <set>
#include <string>
#include "core/Program.hpp"

namespace pg {

/// Keeps module instances alive across compiles so hot-swaps preserve DSP state. Message thread only.
class InstanceTable {
public:
  /// Reuses the instance when the type is unchanged; otherwise creates and prepares a new one.
  /// Params are applied only to newly created instances (live ones change through the param queue).
  std::shared_ptr<ModuleInstance> acquire(const std::string& id, const RegisteredModule& type,
                                          const PrepareInfo& info, const std::map<std::string, float>& params);
  std::shared_ptr<FeedbackState> acquireFeedback(const std::string& edgeId, uint32_t channels);
  void prune(const std::set<std::string>& liveNodeIds, const std::set<std::string>& liveEdgeIds);
  const ModuleInstance* find(const std::string& id) const;
  size_t size() const { return byId_.size(); }

private:
  std::map<std::string, std::shared_ptr<ModuleInstance>> byId_;
  std::map<std::string, std::shared_ptr<FeedbackState>> feedbackById_;
  PrepareInfo lastInfo_{};
  uint64_t nextSerial_ = 1;
};

}  // namespace pg
```

`engine/src/core/InstanceTable.cpp`:
```cpp
#include "core/InstanceTable.hpp"

namespace pg {

std::shared_ptr<ModuleInstance> InstanceTable::acquire(const std::string& id, const RegisteredModule& type,
                                                       const PrepareInfo& info, const std::map<std::string, float>& params) {
  if (!(info == lastInfo_)) {       // sample rate / block / voices changed: re-prepare everything
    for (auto& [k, inst] : byId_) {
      inst->module->prepare(info);
      for (auto& p : inst->params) p.prepare(p.desc, info.sampleRate, p.target);
    }
    lastInfo_ = info;
  }
  auto it = byId_.find(id);
  if (it != byId_.end() && it->second->type == &type) return it->second;

  auto inst = std::make_shared<ModuleInstance>();
  inst->id = id;
  inst->serial = nextSerial_++;
  inst->type = &type;
  inst->module.reset(type.desc->create());
  inst->module->prepare(info);
  inst->params.resize(type.desc->numParams);
  for (uint32_t i = 0; i < type.desc->numParams; ++i) {
    const ParamDesc& d = type.desc->params[i];
    auto pv = params.find(d.id);
    const float value = pv == params.end() ? d.def : pv->second;
    inst->params[i].prepare(&d, info.sampleRate, paramNormalize(d, value));
  }
  byId_[id] = inst;
  return inst;
}

std::shared_ptr<FeedbackState> InstanceTable::acquireFeedback(const std::string& edgeId, uint32_t channels) {
  auto it = feedbackById_.find(edgeId);
  if (it != feedbackById_.end() && it->second->channels == channels) return it->second;
  auto fb = std::make_shared<FeedbackState>();
  fb->channels = channels;
  feedbackById_[edgeId] = fb;
  return fb;
}

void InstanceTable::prune(const std::set<std::string>& liveNodeIds, const std::set<std::string>& liveEdgeIds) {
  for (auto it = byId_.begin(); it != byId_.end();) it = liveNodeIds.contains(it->first) ? std::next(it) : byId_.erase(it);
  for (auto it = feedbackById_.begin(); it != feedbackById_.end();) it = liveEdgeIds.contains(it->first) ? std::next(it) : feedbackById_.erase(it);
}

const ModuleInstance* InstanceTable::find(const std::string& id) const {
  auto it = byId_.find(id);
  return it == byId_.end() ? nullptr : it->second.get();
}

}  // namespace pg
```

- [ ] **Step 5: Write the Scheduler**

`engine/src/core/Scheduler.hpp`:
```cpp
#pragma once
#include <array>
#include "core/Program.hpp"
#include "rt/RtAssert.hpp"

namespace pg {

/// Executes a Program's op list. All methods are audio-thread safe after construction.
class Scheduler {
public:
  PG_RT_NONBLOCKING void run(Program& p, uint32_t numFrames, const TransportSnapshot& t, AudioBus* bus);

private:
  void exec(Program& p, const Op& op, uint32_t offset, uint32_t n, uint32_t voice, const TransportSnapshot& t, AudioBus* bus);
  void runCluster(Program& p, size_t first, uint32_t count, uint32_t numFrames, uint32_t voice, const TransportSnapshot& t, AudioBus* bus);
  SignalView view(Program& p, uint32_t buf, uint32_t offset, uint32_t n) const;

  std::array<SignalView, kMaxPortsPerModule> in_{}, out_{};
  std::array<const EventBuffer*, kMaxPortsPerModule> evIn_{};
  std::array<EventBuffer*, kMaxPortsPerModule> evOut_{};
  std::array<ParamView, kMaxParamsPerModule> params_{};
  EventBuffer emptyEvents_;
};

}  // namespace pg
```

`engine/src/core/Scheduler.cpp`:
```cpp
#include "core/Scheduler.hpp"

namespace pg {

SignalView Scheduler::view(Program& p, uint32_t buf, uint32_t offset, uint32_t n) const {
  SignalView v;
  v.numChannels = p.bufferChannels[buf];
  v.numFrames = n;
  for (uint32_t c = 0; c < v.numChannels; ++c) v.ch[c] = p.buffers[buf].data(c) + offset;
  return v;
}

void Scheduler::run(Program& p, uint32_t numFrames, const TransportSnapshot& t, AudioBus* bus) {
  p.buffers[kSilentBuffer].clear();
  p.eventBufs[kEmptyEvents].clear();
  for (NodeSlot& slot : p.nodes)
    for (ParamState& ps : slot.inst->params) ps.fillRamp(numFrames);

  for (uint32_t voice = 0; voice < p.voiceCount; ++voice) {
    for (size_t i = 0; i < p.ops.size(); ++i) {
      const Op& op = p.ops[i];
      if (op.kind == Op::ClusterBegin) {
        runCluster(p, i + 1, op.a, numFrames, voice, t, bus);
        i += op.a + 1;   // skip the cluster body and its ClusterEnd
        continue;
      }
      exec(p, op, 0, numFrames, voice, t, bus);
    }
  }
}

void Scheduler::runCluster(Program& p, size_t first, uint32_t count, uint32_t numFrames, uint32_t voice, const TransportSnapshot& t, AudioBus* bus) {
  if (p.feedbackMode == FeedbackMode::Block) {
    for (uint32_t k = 0; k < count; ++k) exec(p, p.ops[first + k], 0, numFrames, voice, t, bus);
    return;
  }
  for (uint32_t s = 0; s < numFrames; ++s)
    for (uint32_t k = 0; k < count; ++k) exec(p, p.ops[first + k], s, 1, voice, t, bus);
}

void Scheduler::exec(Program& p, const Op& op, uint32_t offset, uint32_t n, uint32_t voice, const TransportSnapshot& t, AudioBus* bus) {
  switch (op.kind) {
    case Op::Sum: {
      SignalView dst = view(p, op.a, offset, n);
      dst.clear();
      for (uint32_t k = 0; k < op.c; ++k) {
        const SignalView src = view(p, p.args[op.b + k], offset, n);
        for (uint32_t c = 0; c < dst.numChannels; ++c) {
          float* d = dst.write(c); const float* s = src.read(c);
          for (uint32_t i = 0; i < n; ++i) d[i] += s[i];
        }
      }
      return;
    }
    case Op::Merge: {
      if (offset != 0) return;   // events are merged once per block even inside clusters
      std::array<const EventBuffer*, kMaxPortsPerModule> srcs{};
      for (uint32_t k = 0; k < op.c; ++k) srcs[k] = &p.eventBufs[p.args[op.b + k]];
      mergeEvents(srcs.data(), op.c, p.eventBufs[op.a]);
      return;
    }
    case Op::ClearEvents:
      if (offset == 0) p.eventBufs[op.a].clear();
      return;
    case Op::FillParam: {
      const NodeSlot& slot = p.nodes[op.a];
      ParamState& ps = slot.inst->params[op.b];
      float* dst = p.buffers[slot.paramBuf[op.b]].data(0) + offset;
      const float* mod = p.buffers[op.c].data(0) + offset;
      for (uint32_t i = 0; i < n; ++i) {
        const float norm = ps.rampIsConstant ? ps.constNorm : ps.rampNorm[offset + i];
        dst[i] = paramDenormalize(*ps.desc, norm + mod[i]);
      }
      return;
    }
    case Op::FeedbackRead: {
      FeedbackState& fb = *p.feedback[op.a];
      for (uint32_t c = 0; c < fb.channels; ++c) {
        float* d = p.buffers[op.b].data(c) + offset;
        for (uint32_t i = 0; i < n; ++i) d[i] = fb.z[c][i];
      }
      return;
    }
    case Op::FeedbackWrite: {
      FeedbackState& fb = *p.feedback[op.a];
      const SignalView src = view(p, op.b, offset, n);
      for (uint32_t c = 0; c < fb.channels; ++c) {
        const float* s = src.read(c);
        for (uint32_t i = 0; i < n; ++i) fb.z[c][i] = s[i];
      }
      return;
    }
    case Op::Process: {
      NodeSlot& slot = p.nodes[op.a];
      const ModuleDescriptor& d = *slot.inst->type->desc;
      for (uint32_t i = 0; i < d.numInputs; ++i) {
        in_[i] = slot.inBuf[i] == kNone ? SignalView{} : view(p, slot.inBuf[i], offset, n);
        evIn_[i] = slot.inEvt[i] == kNone ? &emptyEvents_ : &p.eventBufs[slot.inEvt[i]];
      }
      for (uint32_t i = 0; i < d.numOutputs; ++i) {
        out_[i] = slot.outBuf[i] == kNone ? SignalView{} : view(p, slot.outBuf[i], offset, n);
        evOut_[i] = slot.outEvt[i] == kNone ? &emptyEvents_ : &p.eventBufs[slot.outEvt[i]];
      }
      for (uint32_t i = 0; i < d.numParams; ++i) {
        const ParamState& ps = slot.inst->params[i];
        if (slot.paramBuf[i] != kNone) params_[i] = ParamView{p.buffers[slot.paramBuf[i]].data(0) + offset, 0.f};
        else if (ps.rampIsConstant) params_[i] = ParamView{nullptr, ps.constValue};
        else params_[i] = ParamView{ps.rampValue.data() + offset, 0.f};
      }
      AudioBus busSlice;
      if (bus) { busSlice = *bus; busSlice.frames = n; for (uint32_t c = 0; c < bus->channels; ++c) busSlice.ch[c] = bus->ch[c] + offset; }
      ProcessContext ctx;
      ctx.numFrames = n; ctx.voice = voice; ctx.sampleRate = p.sampleRate; ctx.transport = &t;
      ctx.outputBus = bus ? &busSlice : nullptr;
      ctx.inputs = in_.data(); ctx.outputs = out_.data(); ctx.eventInputs = evIn_.data(); ctx.eventOutputs = evOut_.data();
      ctx.params = params_.data();
      slot.inst->module->process(ctx);
      return;
    }
    case Op::ClusterBegin:
    case Op::ClusterEnd:
      return;
  }
}

}  // namespace pg
```

- [ ] **Step 6: Run the tests** — `npm run engine:test`: both scheduler tests pass.

- [ ] **Step 7: Commit**

```bash
git add engine
git commit -m "feat(engine): Program, InstanceTable and Scheduler executing op lists"
```

---

### Task 11: GraphCompiler for acyclic graphs

**Files:**
- Create: `engine/src/core/GraphCompiler.hpp`, `engine/src/core/GraphCompiler.cpp`
- Create: `engine/tests/util/GraphFixture.hpp`
- Test: `engine/tests/test_graph.cpp`

**Interfaces:**
- Produces: `pg::CompileOutput { std::unique_ptr<Program> program; std::string error; }`, `pg::CompileOutput pg::compileGraph(const GraphModel&, const Registry&, InstanceTable&, uint64_t revision, double sampleRate, uint32_t blockSize)`. Cycles return error `"E_FEEDBACK_UNSUPPORTED"` in this task; Task 12 replaces that with clusters.
- Test fixture `pg::test::GraphFixture { Registry reg; GraphModel model; InstanceTable table; Scheduler scheduler; void node(id, type, params={}); void edge(id, "node.port", "node.port"); std::unique_ptr<Program> compile(); const float* out(Program&, node, port); void run(Program&, frames, AudioBus* = nullptr); }`.

- [ ] **Step 1: Write the fixture and failing tests**

`engine/tests/util/GraphFixture.hpp`:
```cpp
#pragma once
#include <stdexcept>
#include <string>
#include "core/GraphCompiler.hpp"
#include "core/InstanceTable.hpp"
#include "core/Scheduler.hpp"
#include "modules/TestModules.hpp"

namespace pg::test {

struct GraphFixture {
  Registry reg;
  GraphModel model;
  InstanceTable table;
  Scheduler scheduler;
  uint64_t revision = 0;
  TransportSnapshot transport;

  GraphFixture() { registerTestModules(reg); }

  void node(const std::string& id, const std::string& type, std::map<std::string, float> params = {}) {
    Result r = model.addNode(reg, NodeModel{id, type, std::move(params)});
    if (!r) throw std::runtime_error(r.message);
  }
  /// endpoints are "node.port"
  void edge(const std::string& id, const std::string& from, const std::string& to) {
    auto split = [](const std::string& s) { auto d = s.find('.'); return std::pair{s.substr(0, d), s.substr(d + 1)}; };
    auto [fn, fp] = split(from); auto [tn, tp] = split(to);
    Result r = model.addEdge(reg, EdgeModel{id, fn, fp, tn, tp});
    if (!r) throw std::runtime_error(r.message);
  }
  std::unique_ptr<Program> compile(double sampleRate = 48000.0, uint32_t block = 64) {
    CompileOutput o = compileGraph(model, reg, table, ++revision, sampleRate, block);
    if (!o.program) throw std::runtime_error(o.error);
    return std::move(o.program);
  }
  const float* out(Program& p, const std::string& nodeId, const std::string& port) {
    for (const NodeSlot& s : p.nodes)
      if (s.inst->id == nodeId) return p.buffers[s.outBuf[static_cast<size_t>(s.inst->type->findOutput(port))]].data(0);
    throw std::runtime_error("no node " + nodeId);
  }
  void run(Program& p, uint32_t frames, AudioBus* bus = nullptr) { scheduler.run(p, frames, transport, bus); }
};

}  // namespace pg::test
```

`engine/tests/test_graph.cpp`:
```cpp
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include "util/GraphFixture.hpp"

using pg::test::GraphFixture;

TEST_CASE("compile: chain const -> gain", "[compiler]") {
  GraphFixture f;
  f.node("c", "test.const", {{"value", 0.5f}});
  f.node("g", "test.gain", {{"gain", 0.5f}});
  f.edge("e", "c.out", "g.in");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "g", "out")[63] == Catch::Approx(0.25f));
}

TEST_CASE("compile: fan-in sums, unconnected inputs are silent", "[compiler]") {
  GraphFixture f;
  f.node("a", "test.const", {{"value", 0.25f}});
  f.node("b", "test.const", {{"value", 0.5f}});
  f.node("g", "test.gain");
  f.node("lonely", "test.gain");
  f.edge("e1", "a.out", "g.in");
  f.edge("e2", "b.out", "g.in");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "g", "out")[0] == Catch::Approx(0.75f));
  REQUIRE(f.out(*p, "lonely", "out")[0] == 0.f);
}

TEST_CASE("compile: implicit param port modulates the knob", "[compiler]") {
  GraphFixture f;
  f.node("in", "test.const", {{"value", 1.f}});
  f.node("mod", "test.const", {{"value", 0.2f}});
  f.node("g", "test.gain", {{"gain", 0.5f}});
  f.edge("e1", "in.out", "g.in");
  f.edge("e2", "mod.out", "g.param:gain");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "g", "out")[10] == Catch::Approx(0.9f));   // norm 0.25 + 0.2 -> 0.9
}

TEST_CASE("compile: event ports merge by frame", "[compiler]") {
  GraphFixture f;
  f.node("e1", "test.eventGen", {{"frame", 3.f}, {"tag", 2.f}});
  f.node("e2", "test.eventGen", {{"frame", 3.f}, {"tag", 5.f}});
  f.node("t", "test.eventTrace");
  f.edge("x", "e1.events", "t.events");
  f.edge("y", "e2.events", "t.events");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "t", "out")[3] == Catch::Approx(7.f));
}

TEST_CASE("compile: topological order is respected regardless of id order", "[compiler]") {
  GraphFixture f;
  f.node("z_source", "test.const", {{"value", 0.5f}});
  f.node("a_sink", "test.gain");
  f.edge("e", "z_source.out", "a_sink.in");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "a_sink", "out")[0] == Catch::Approx(0.5f));
}

TEST_CASE("compile: reuses instances across compiles", "[compiler]") {
  GraphFixture f;
  f.node("c", "test.const", {{"value", 0.5f}});
  auto p1 = f.compile();
  f.node("g", "test.gain");
  auto p2 = f.compile();
  REQUIRE(p1->nodes[0].inst.get() == p2->nodes[0].inst.get());
  REQUIRE(f.table.size() == 2);
}

TEST_CASE("compile: cycles are rejected until Task 12", "[compiler]") {
  GraphFixture f;
  f.node("a", "test.add");
  f.node("g", "test.gain");
  f.edge("e1", "a.out", "g.in");
  f.edge("e2", "g.out", "a.b");
  pg::CompileOutput o = pg::compileGraph(f.model, f.reg, f.table, 1, 48000.0, 64);
  REQUIRE(o.program == nullptr);
  REQUIRE(o.error.find("E_FEEDBACK_UNSUPPORTED") != std::string::npos);
}
```

- [ ] **Step 2: Run to verify failure** — compile error, `core/GraphCompiler.hpp` missing.

- [ ] **Step 3: Write the compiler**

`engine/src/core/GraphCompiler.hpp`:
```cpp
#pragma once
#include <memory>
#include <string>
#include "core/GraphModel.hpp"
#include "core/InstanceTable.hpp"
#include "core/Program.hpp"

namespace pg {

struct CompileOutput {
  std::unique_ptr<Program> program;   // null on error
  std::string error;                  // "E_CODE: message"
};

/// Message thread. Allocates everything the audio thread will need.
CompileOutput compileGraph(const GraphModel& model, const Registry& registry, InstanceTable& instances,
                           uint64_t revision, double sampleRate, uint32_t blockSize);

}  // namespace pg
```

`engine/src/core/GraphCompiler.cpp`:
```cpp
#include "core/GraphCompiler.hpp"
#include <algorithm>
#include <functional>
#include <set>

namespace pg {
namespace {

struct EdgeRef {
  const EdgeModel* model;
  uint32_t from, fromPort;   // node index, output index
  uint32_t to, toPort;       // node index, input index (declared + implicit)
  bool back = false;         // set in Task 12
};

struct Tarjan {
  const std::vector<std::vector<uint32_t>>& adj;
  std::vector<int32_t> index, low, comp;
  std::vector<bool> onStack;
  std::vector<uint32_t> stack;
  std::vector<std::vector<uint32_t>> sccs;   // emitted in reverse topological order
  int32_t counter = 0;

  explicit Tarjan(const std::vector<std::vector<uint32_t>>& a)
      : adj(a), index(a.size(), -1), low(a.size(), 0), comp(a.size(), -1), onStack(a.size(), false) {
    for (uint32_t v = 0; v < a.size(); ++v) if (index[v] < 0) visit(v);
  }
  void visit(uint32_t v) {
    index[v] = low[v] = counter++;
    stack.push_back(v); onStack[v] = true;
    for (uint32_t w : adj[v]) {
      if (index[w] < 0) { visit(w); low[v] = std::min(low[v], low[w]); }
      else if (onStack[w]) low[v] = std::min(low[v], index[w]);
    }
    if (low[v] == index[v]) {
      std::vector<uint32_t> scc;
      for (;;) { uint32_t w = stack.back(); stack.pop_back(); onStack[w] = false; comp[w] = static_cast<int32_t>(sccs.size()); scc.push_back(w); if (w == v) break; }
      sccs.push_back(std::move(scc));
    }
  }
};

}  // namespace

CompileOutput compileGraph(const GraphModel& model, const Registry& registry, InstanceTable& instances,
                           uint64_t revision, double sampleRate, uint32_t blockSize) {
  auto fail = [](const std::string& code, const std::string& msg) { return CompileOutput{nullptr, code + ": " + msg}; };
  if (blockSize == 0 || blockSize > kMaxBlockSize) return fail("E_BLOCK", "bad block size");

  // 1. Nodes in id order, resolve types, acquire instances.
  std::vector<const NodeModel*> nodes;
  std::vector<const RegisteredModule*> types;
  std::map<std::string, uint32_t> indexOf;
  for (const auto& [id, n] : model.nodes()) {
    const RegisteredModule* t = registry.find(n.type);
    if (!t) return fail("E_UNKNOWN_TYPE", n.type);
    indexOf[id] = static_cast<uint32_t>(nodes.size());
    nodes.push_back(&n); types.push_back(t);
  }
  const uint32_t N = static_cast<uint32_t>(nodes.size());
  PrepareInfo info{sampleRate, kMaxBlockSize, model.voiceCount};

  // 2. Resolve edges.
  std::vector<EdgeRef> edges;
  for (const auto& [id, e] : model.edges()) {
    EdgeRef r{&e, indexOf.at(e.fromNode), 0, indexOf.at(e.toNode), 0};
    const int32_t op = types[r.from]->findOutput(e.fromPort);
    const int32_t ip = types[r.to]->findInput(e.toPort);
    if (op < 0 || ip < 0) return fail("E_PORT_NOT_FOUND", id);
    r.fromPort = static_cast<uint32_t>(op); r.toPort = static_cast<uint32_t>(ip);
    edges.push_back(r);
  }

  // 3. SCC / topological order.
  std::vector<std::vector<uint32_t>> adj(N);
  for (const EdgeRef& e : edges) adj[e.from].push_back(e.to);
  Tarjan tarjan(adj);
  for (const auto& scc : tarjan.sccs) {
    if (scc.size() > 1) return fail("E_FEEDBACK_UNSUPPORTED", "cycle detected");
    for (uint32_t w : adj[scc[0]]) if (w == scc[0]) return fail("E_FEEDBACK_UNSUPPORTED", "self loop");
  }
  std::vector<uint32_t> order;
  for (auto it = tarjan.sccs.rbegin(); it != tarjan.sccs.rend(); ++it) order.push_back((*it)[0]);

  // 4. Program skeleton and output buffers.
  auto p = std::make_unique<Program>();
  p->revision = revision; p->voiceCount = model.voiceCount; p->blockSize = blockSize; p->sampleRate = sampleRate;
  p->feedbackMode = model.feedbackMode;
  p->allocBuffer(1);        // kSilentBuffer
  p->allocEventBuffer();    // kEmptyEvents
  p->nodes.resize(N);
  for (uint32_t i = 0; i < N; ++i) {
    NodeSlot& s = p->nodes[i];
    const ModuleDescriptor& d = *types[i]->desc;
    s.inst = instances.acquire(nodes[i]->id, *types[i], info, nodes[i]->params);
    s.inBuf.assign(d.numInputs, kNone); s.inEvt.assign(d.numInputs, kNone);
    s.outBuf.assign(d.numOutputs, kNone); s.outEvt.assign(d.numOutputs, kNone);
    s.paramBuf.assign(d.numParams, kNone);
    for (uint32_t o = 0; o < d.numOutputs; ++o) {
      if (d.outputs[o].kind == PortKind::Continuous) s.outBuf[o] = p->allocBuffer(d.outputs[o].channels);
      else s.outEvt[o] = p->allocEventBuffer();
    }
    for (uint32_t k = 0; k < d.numInputs; ++k)
      if (d.inputs[k].kind == PortKind::Continuous) s.inBuf[k] = kSilentBuffer; else s.inEvt[k] = kEmptyEvents;
  }

  // 5. Per node in topo order: wire inputs (sum/merge), params (fill), then process.
  for (uint32_t ni : order) {
    NodeSlot& s = p->nodes[ni];
    const RegisteredModule& t = *types[ni];
    const ModuleDescriptor& d = *t.desc;
    for (uint32_t ip = 0; ip < t.inputs.size(); ++ip) {
      std::vector<uint32_t> srcs;
      for (const EdgeRef& e : edges) {
        if (e.to != ni || e.toPort != ip) continue;
        const NodeSlot& src = p->nodes[e.from];
        srcs.push_back(t.inputs[ip].kind == PortKind::Continuous ? src.outBuf[e.fromPort] : src.outEvt[e.fromPort]);
      }
      if (srcs.empty()) continue;
      const bool continuous = t.inputs[ip].kind == PortKind::Continuous;
      uint32_t result;
      if (srcs.size() == 1) {
        result = srcs[0];
      } else if (continuous) {
        uint32_t ch = 1; for (uint32_t b : srcs) ch = std::max(ch, p->bufferChannels[b]);
        result = p->allocBuffer(ch);
        const uint32_t argStart = static_cast<uint32_t>(p->args.size());
        p->args.insert(p->args.end(), srcs.begin(), srcs.end());
        p->ops.push_back(Op{Op::Sum, result, argStart, static_cast<uint32_t>(srcs.size())});
      } else {
        result = p->allocEventBuffer();
        const uint32_t argStart = static_cast<uint32_t>(p->args.size());
        p->args.insert(p->args.end(), srcs.begin(), srcs.end());
        p->ops.push_back(Op{Op::Merge, result, argStart, static_cast<uint32_t>(srcs.size())});
      }
      const int32_t paramIdx = t.inputParam[ip];
      if (paramIdx < 0) { if (continuous) s.inBuf[ip] = result; else s.inEvt[ip] = result; }
      else {
        s.paramBuf[paramIdx] = p->allocBuffer(1);
        p->ops.push_back(Op{Op::FillParam, ni, static_cast<uint32_t>(paramIdx), result});
      }
    }
    for (uint32_t o = 0; o < d.numOutputs; ++o)
      if (s.outEvt[o] != kNone) p->ops.push_back(Op{Op::ClearEvents, s.outEvt[o]});
    p->ops.push_back(Op{Op::Process, ni});
  }

  p->buildSerialIndex();
  std::set<std::string> liveNodes, liveEdges;
  for (const auto& [id, n] : model.nodes()) liveNodes.insert(id);
  for (const auto& [id, e] : model.edges()) liveEdges.insert(id);
  instances.prune(liveNodes, liveEdges);
  return CompileOutput{std::move(p), ""};
}

}  // namespace pg
```

- [ ] **Step 4: Run the tests** — `npm run engine:test`: all `[compiler]` tests pass.

- [ ] **Step 5: Commit**

```bash
git add engine
git commit -m "feat(engine): graph compiler for acyclic graphs with fan-in and implicit param ports"
```

---

### Task 12: Feedback clusters with one-sample delay

**Files:**
- Modify: `engine/src/core/GraphCompiler.cpp`
- Test: `engine/tests/test_feedback.cpp`; modify `engine/tests/test_graph.cpp` (remove the "cycles are rejected" case)

**Interfaces:**
- Produces: the compiler emits `ClusterBegin … ClusterEnd` around every SCC with ≥ 2 nodes or a self loop; back edges get a `FeedbackState` (reused by edge id) and `FeedbackRead`/`FeedbackWrite` ops. Event back edges return `E_EVENT_FEEDBACK` (no test module can form an event cycle yet; covered when `note.toCv` arrives).

- [ ] **Step 1: Write the failing tests**

Delete the `"compile: cycles are rejected until Task 12"` test from `test_graph.cpp`. Create `engine/tests/test_feedback.cpp`:
```cpp
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include "util/GraphFixture.hpp"
#include "util/RtGuard.hpp"

using pg::test::GraphFixture;

// y[n] = x[n] + 0.5 * y[n-1] with x = impulse -> 1, 0.5, 0.25, ...
static void buildIir(GraphFixture& f) {
  f.node("add", "test.add");
  f.node("gain", "test.gain", {{"gain", 0.5f}});
  f.node("x", "test.impulse");
  f.edge("e_in", "x.out", "add.a");
  f.edge("e_fwd", "add.out", "gain.in");
  f.edge("e_back", "gain.out", "add.b");
}

TEST_CASE("feedback: per-sample cluster has exactly one sample of delay", "[feedback]") {
  GraphFixture f; buildIir(f);
  auto p = f.compile();
  f.run(*p, 64);
  const float* y = f.out(*p, "add", "out");
  REQUIRE(y[0] == 1.f);
  REQUIRE(y[1] == 0.5f);
  REQUIRE(y[2] == 0.25f);
  REQUIRE(y[10] == Catch::Approx(std::pow(0.5, 10)));
  const float last = y[63];
  f.run(*p, 64);                                 // state continues across blocks
  REQUIRE(y[0] == Catch::Approx(last * 0.5f));
}

TEST_CASE("feedback: block mode delays by one block", "[feedback]") {
  GraphFixture f; buildIir(f);
  f.model.feedbackMode = pg::FeedbackMode::Block;
  auto p = f.compile();
  f.run(*p, 64);
  const float* y = f.out(*p, "add", "out");
  REQUIRE(y[0] == 1.f);
  REQUIRE(y[1] == 0.f);
  f.run(*p, 64);
  REQUIRE(y[0] == 0.5f);
  REQUIRE(y[1] == 0.f);
}

TEST_CASE("feedback: self loop", "[feedback]") {
  GraphFixture f;
  f.node("g", "test.gain", {{"gain", 0.5f}});
  f.node("x", "test.impulse");
  f.edge("e_in", "x.out", "g.in");
  f.edge("e_self", "g.out", "g.in");
  auto p = f.compile();
  f.run(*p, 64);
  const float* y = f.out(*p, "g", "out");   // y[n] = 0.5 (x[n] + y[n-1])
  REQUIRE(y[0] == 0.5f);
  REQUIRE(y[1] == 0.25f);
  REQUIRE(y[2] == 0.125f);
}

TEST_CASE("feedback: FeedbackState survives recompiles", "[feedback]") {
  GraphFixture f; buildIir(f);
  auto p1 = f.compile();
  f.run(*p1, 64);
  const float last = f.out(*p1, "add", "out")[63];
  f.node("unrelated", "test.const");
  auto p2 = f.compile();
  f.run(*p2, 64);
  REQUIRE(f.out(*p2, "add", "out")[0] == Catch::Approx(last * 0.5f));
}

TEST_CASE("feedback: scheduler run is allocation free", "[feedback][rt]") {
  GraphFixture f; buildIir(f);
  auto p = f.compile();
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; for (int i = 0; i < 20; ++i) f.run(*p, 64); }
  REQUIRE(pg::test::rtViolations() == 0);
}
```

- [ ] **Step 2: Run to verify failure** — the first four `[feedback]` tests fail (`E_FEEDBACK_UNSUPPORTED`).

- [ ] **Step 3: Replace the SCC handling and emission in `GraphCompiler.cpp`**

Replace step 3 ("SCC / topological order") with:
```cpp
  // 3. SCCs in topological order; inside each non-trivial SCC pick a deterministic order and mark back edges.
  std::vector<std::vector<uint32_t>> adj(N);
  for (const EdgeRef& e : edges) adj[e.from].push_back(e.to);
  Tarjan tarjan(adj);
  struct Group { std::vector<uint32_t> nodes; bool cluster = false; };
  std::vector<Group> groups;
  std::vector<uint32_t> pos(N, 0);
  for (auto it = tarjan.sccs.rbegin(); it != tarjan.sccs.rend(); ++it) {
    Group g; g.nodes = *it;
    std::sort(g.nodes.begin(), g.nodes.end());
    bool selfLoop = false;
    for (uint32_t w : adj[g.nodes[0]]) if (g.nodes.size() == 1 && w == g.nodes[0]) selfLoop = true;
    g.cluster = g.nodes.size() > 1 || selfLoop;
    if (g.cluster) {   // DFS from the smallest id following intra-SCC edges gives a stable order
      const int32_t c = tarjan.comp[g.nodes[0]];
      std::vector<uint32_t> ordered; std::vector<bool> seen(N, false);
      std::function<void(uint32_t)> dfs = [&](uint32_t v) {
        seen[v] = true; ordered.push_back(v);
        std::vector<uint32_t> next = adj[v]; std::sort(next.begin(), next.end());
        for (uint32_t w : next) if (tarjan.comp[w] == c && !seen[w]) dfs(w);
      };
      for (uint32_t v : g.nodes) if (!seen[v]) dfs(v);
      g.nodes = ordered;
    }
    for (uint32_t i = 0; i < g.nodes.size(); ++i) pos[g.nodes[i]] = i;
    groups.push_back(std::move(g));
  }
  for (EdgeRef& e : edges) {
    if (tarjan.comp[e.from] != tarjan.comp[e.to]) continue;
    if (pos[e.from] >= pos[e.to]) {
      e.back = true;
      if (types[e.from]->desc->outputs[e.fromPort].kind == PortKind::Event) return fail("E_EVENT_FEEDBACK", e.model->id);
    }
  }
```

Replace step 5 (the `for (uint32_t ni : order)` loop) with a per-group emission. Add these helpers above the loop:
```cpp
  // Back-edge feedback states and their read buffers, keyed by edge index.
  std::map<size_t, uint32_t> fbIndexOfEdge, fbBufOfEdge;
  for (size_t ei = 0; ei < edges.size(); ++ei) {
    if (!edges[ei].back) continue;
    const uint32_t ch = p->bufferChannels[p->nodes[edges[ei].from].outBuf[edges[ei].fromPort]];
    fbIndexOfEdge[ei] = static_cast<uint32_t>(p->feedback.size());
    p->feedback.push_back(instances.acquireFeedback(edges[ei].model->id, ch));
    fbBufOfEdge[ei] = p->allocBuffer(ch);
  }

  auto emitNode = [&](uint32_t ni) {
    NodeSlot& s = p->nodes[ni];
    const RegisteredModule& t = *types[ni];
    const ModuleDescriptor& d = *t.desc;
    for (uint32_t ip = 0; ip < t.inputs.size(); ++ip) {
      std::vector<uint32_t> srcs;
      for (size_t ei = 0; ei < edges.size(); ++ei) {
        const EdgeRef& e = edges[ei];
        if (e.to != ni || e.toPort != ip) continue;
        const NodeSlot& src = p->nodes[e.from];
        if (e.back) srcs.push_back(fbBufOfEdge.at(ei));
        else srcs.push_back(t.inputs[ip].kind == PortKind::Continuous ? src.outBuf[e.fromPort] : src.outEvt[e.fromPort]);
      }
      if (srcs.empty()) continue;
      const bool continuous = t.inputs[ip].kind == PortKind::Continuous;
      uint32_t result;
      if (srcs.size() == 1) {
        result = srcs[0];
      } else if (continuous) {
        uint32_t ch = 1; for (uint32_t b : srcs) ch = std::max(ch, p->bufferChannels[b]);
        result = p->allocBuffer(ch);
        const uint32_t argStart = static_cast<uint32_t>(p->args.size());
        p->args.insert(p->args.end(), srcs.begin(), srcs.end());
        p->ops.push_back(Op{Op::Sum, result, argStart, static_cast<uint32_t>(srcs.size())});
      } else {
        result = p->allocEventBuffer();
        const uint32_t argStart = static_cast<uint32_t>(p->args.size());
        p->args.insert(p->args.end(), srcs.begin(), srcs.end());
        p->ops.push_back(Op{Op::Merge, result, argStart, static_cast<uint32_t>(srcs.size())});
      }
      const int32_t paramIdx = t.inputParam[ip];
      if (paramIdx < 0) { if (continuous) s.inBuf[ip] = result; else s.inEvt[ip] = result; }
      else {
        s.paramBuf[paramIdx] = p->allocBuffer(1);
        p->ops.push_back(Op{Op::FillParam, ni, static_cast<uint32_t>(paramIdx), result});
      }
    }
    for (uint32_t o = 0; o < d.numOutputs; ++o)
      if (s.outEvt[o] != kNone) p->ops.push_back(Op{Op::ClearEvents, s.outEvt[o]});
    p->ops.push_back(Op{Op::Process, ni});
    for (size_t ei = 0; ei < edges.size(); ++ei)
      if (edges[ei].back && edges[ei].from == ni)
        p->ops.push_back(Op{Op::FeedbackWrite, fbIndexOfEdge.at(ei), p->nodes[ni].outBuf[edges[ei].fromPort]});
  };

  for (const Group& g : groups) {
    if (!g.cluster) { emitNode(g.nodes[0]); continue; }
    const size_t beginAt = p->ops.size();
    p->ops.push_back(Op{Op::ClusterBegin, 0});
    for (size_t ei = 0; ei < edges.size(); ++ei)
      if (edges[ei].back && pos[edges[ei].to] <= pos[edges[ei].from] && tarjan.comp[edges[ei].to] == tarjan.comp[g.nodes[0]])
        p->ops.push_back(Op{Op::FeedbackRead, fbIndexOfEdge.at(ei), fbBufOfEdge.at(ei)});
    for (uint32_t ni : g.nodes) emitNode(ni);
    p->ops[beginAt].a = static_cast<uint32_t>(p->ops.size() - beginAt - 1);
    p->ops.push_back(Op{Op::ClusterEnd});
  }
```
Remove the old `order` vector and the `E_FEEDBACK_UNSUPPORTED` checks. Add `#include <map>` at the top.

- [ ] **Step 4: Run the tests** — `npm run engine:test`: all `[feedback]` and `[compiler]` tests pass. The IIR values must be exact (`==`), which holds because powers of two are exact in float.

- [ ] **Step 5: Commit**

```bash
git add engine
git commit -m "feat(engine): per-sample feedback clusters with one-sample delay on back edges"
```

---

### Task 13: Engine with atomic program swap, retire queue and param queue

**Files:**
- Create: `engine/src/core/Engine.hpp`, `engine/src/core/Engine.cpp`
- Test: `engine/tests/test_hotswap.cpp`

**Interfaces:**
- Produces: `pg::EngineConfig { double sampleRate = 48000; uint32_t blockSize = 64; }`, `pg::Engine(Registry&, EngineConfig)` with message-thread API `GraphModel& model()`, `Result commit()`, `Result setParam(node, param, value)`, `void collectGarbage()`, `uint64_t revision() const`, `size_t retiredCount() const`, `const EngineConfig& config() const`; audio-thread API `void renderBlock(float* const* out, uint32_t channels, uint32_t numFrames, const TransportSnapshot&)` (planar, `numFrames <= blockSize`) and `void renderInterleaved(float* out, uint32_t frames, uint32_t channels, const TransportSnapshot&)` (any frame count, uses `BlockSplitter`).

- [ ] **Step 1: Write the failing tests**

`engine/tests/test_hotswap.cpp`:
```cpp
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <vector>
#include "core/Engine.hpp"
#include "modules/TestModules.hpp"
#include "util/RtGuard.hpp"

namespace {
struct Rig {
  pg::Registry reg;
  pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
  pg::TransportSnapshot t;
  std::vector<float> l = std::vector<float>(64), r = std::vector<float>(64);
  float* out[2] = {l.data(), r.data()};
  Rig() { pg::test::registerTestModules(reg); }
  void render() { engine.renderBlock(out, 2, 64, t); }
  void add(const std::string& id, const std::string& type, std::map<std::string, float> p = {}) {
    REQUIRE(engine.model().addNode(reg, pg::NodeModel{id, type, std::move(p)}));
  }
  void edge(const std::string& id, const std::string& fn, const std::string& fp, const std::string& tn, const std::string& tp) {
    REQUIRE(engine.model().addEdge(reg, pg::EdgeModel{id, fn, fp, tn, tp}));
  }
};
}  // namespace

TEST_CASE("engine renders silence before any commit and audio after", "[engine]") {
  Rig rig;
  rig.render();
  REQUIRE(rig.l[0] == 0.f);
  rig.add("c", "test.const", {{"value", 0.5f}});
  rig.add("s", "test.sink");
  rig.edge("e", "c", "out", "s", "in");
  REQUIRE(rig.engine.commit());
  rig.render();
  REQUIRE(rig.l[10] == Catch::Approx(0.5f));
  REQUIRE(rig.r[10] == Catch::Approx(0.5f));
}

TEST_CASE("engine hot-swap keeps DSP state continuous", "[engine]") {
  Rig rig;
  rig.add("add", "test.add"); rig.add("gain", "test.gain", {{"gain", 0.5f}}); rig.add("x", "test.impulse"); rig.add("s", "test.sink");
  rig.edge("e1", "x", "out", "add", "a"); rig.edge("e2", "add", "out", "gain", "in"); rig.edge("e3", "gain", "out", "add", "b");
  rig.edge("e4", "add", "out", "s", "in");
  REQUIRE(rig.engine.commit());
  rig.render();
  const float last = rig.l[63];
  REQUIRE(rig.l[0] == 1.f);
  rig.add("unrelated", "test.const");            // graph edit while "playing"
  REQUIRE(rig.engine.commit());
  rig.render();                                  // swap happens at this block boundary
  REQUIRE(rig.l[0] == Catch::Approx(last * 0.5f));
  rig.engine.collectGarbage();
  REQUIRE(rig.engine.retiredCount() == 0);
}

TEST_CASE("engine param changes bypass the swap and are smoothed", "[engine]") {
  Rig rig;
  rig.add("c", "test.const", {{"value", 1.f}}); rig.add("g", "test.gain", {{"gain", 1.f}}); rig.add("s", "test.sink");
  rig.edge("e1", "c", "out", "g", "in"); rig.edge("e2", "g", "out", "s", "in");
  REQUIRE(rig.engine.commit());
  rig.render();
  REQUIRE(rig.l[0] == Catch::Approx(1.f));
  REQUIRE(rig.engine.setParam("g", "gain", 0.f));
  rig.render();
  REQUIRE(rig.l[0] < 1.f);
  REQUIRE(rig.l[63] < rig.l[0]);                // ramping down
  for (int i = 0; i < 40; ++i) rig.render();     // > 5 ms of smoothing
  REQUIRE(rig.l[63] == Catch::Approx(0.f).margin(1e-4));
  REQUIRE(rig.engine.setParam("g", "nope", 0.f).code == "E_PARAM_NOT_FOUND");
}

TEST_CASE("engine commit failure keeps the old program", "[engine]") {
  Rig rig;
  rig.add("c", "test.const", {{"value", 0.5f}}); rig.add("s", "test.sink");
  rig.edge("e", "c", "out", "s", "in");
  REQUIRE(rig.engine.commit());
  const uint64_t rev = rig.engine.revision();
  // A block size above kMaxBlockSize makes compileGraph fail with E_BLOCK; the engine must keep revision and program.
  pg::Engine bad{rig.reg, pg::EngineConfig{48000.0, 1000}};
  pg::Result r = bad.commit();
  REQUIRE_FALSE(r);
  REQUIRE(r.code == "E_BLOCK");
  REQUIRE(rig.engine.revision() == rev);
  rig.render();
  REQUIRE(rig.l[0] == Catch::Approx(0.5f));
}

TEST_CASE("engine render path is allocation free, including the swap", "[engine][rt]") {
  Rig rig;
  rig.add("c", "test.const", {{"value", 0.5f}}); rig.add("s", "test.sink");
  rig.edge("e", "c", "out", "s", "in");
  REQUIRE(rig.engine.commit());
  rig.render();
  rig.add("g", "test.gain");
  REQUIRE(rig.engine.commit());                  // pending program waits for the audio thread
  REQUIRE(rig.engine.setParam("c", "value", 0.1f));
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; for (int i = 0; i < 10; ++i) rig.render(); }
  REQUIRE(pg::test::rtViolations() == 0);
  rig.engine.collectGarbage();
}

TEST_CASE("engine renders interleaved for arbitrary device periods", "[engine]") {
  Rig rig;
  rig.add("c", "test.const", {{"value", 0.25f}}); rig.add("s", "test.sink");
  rig.edge("e", "c", "out", "s", "in");
  REQUIRE(rig.engine.commit());
  std::vector<float> buf(100 * 2);
  rig.engine.renderInterleaved(buf.data(), 100, 2, rig.t);
  rig.engine.renderInterleaved(buf.data(), 100, 2, rig.t);
  REQUIRE(buf[0] == Catch::Approx(0.25f));
  REQUIRE(buf[199] == Catch::Approx(0.25f));
}
```

- [ ] **Step 2: Run to verify failure** — compile error, `core/Engine.hpp` missing.

- [ ] **Step 3: Write the engine**

`engine/src/core/Engine.hpp`:
```cpp
#pragma once
#include <array>
#include <atomic>
#include <memory>
#include <readerwriterqueue.h>
#include "core/GraphModel.hpp"
#include "core/InstanceTable.hpp"
#include "core/Program.hpp"
#include "core/Scheduler.hpp"
#include "rt/RtAssert.hpp"
#include "services/BlockSplitter.hpp"

namespace pg {

struct EngineConfig {
  double sampleRate = 48000.0;
  uint32_t blockSize = kDefaultBlockSize;
};

struct ParamChange {
  uint64_t serial;   // ModuleInstance::serial
  uint32_t param;
  float norm;
};

/// Owns the document mirror, compiles Programs, and hands them to the audio thread.
/// Message-thread methods and audio-thread methods must each be called from a single thread.
class Engine {
public:
  Engine(Registry& registry, EngineConfig config);
  ~Engine();

  // ---- message thread
  GraphModel& model() { return model_; }
  const EngineConfig& config() const { return config_; }
  Result commit();                                        // compile model_ and publish
  Result setParam(const std::string& node, const std::string& param, float value);
  void collectGarbage();                                  // free retired programs; call periodically
  uint64_t revision() const { return revision_; }
  size_t retiredCount() const { return retired_.size_approx(); }

  // ---- audio thread
  PG_RT_NONBLOCKING void renderBlock(float* const* out, uint32_t channels, uint32_t numFrames, const TransportSnapshot& t);
  PG_RT_NONBLOCKING void renderInterleaved(float* out, uint32_t frames, uint32_t channels, const TransportSnapshot& t);

private:
  void swapIfPending();
  void drainParams();

  Registry& registry_;
  EngineConfig config_;
  GraphModel model_;
  InstanceTable instances_;
  Scheduler scheduler_;
  uint64_t revision_ = 0;

  std::unique_ptr<Program> initial_;                   // empty program used before the first commit
  Program* current_ = nullptr;                         // audio thread only
  std::atomic<Program*> pending_{nullptr};
  moodycamel::ReaderWriterQueue<Program*> retired_{256};
  moodycamel::ReaderWriterQueue<ParamChange> params_{4096};

  std::array<std::array<float, kMaxBlockSize>, kMaxChannels> bus_{};
  BlockSplitter splitter_;
  std::array<float, kMaxBlockSize * kMaxChannels> interleavedScratch_{};
};

}  // namespace pg
```

`engine/src/core/Engine.cpp`:
```cpp
#include "core/Engine.hpp"
#include "core/GraphCompiler.hpp"

namespace pg {

Engine::Engine(Registry& registry, EngineConfig config) : registry_(registry), config_(config) {
  initial_ = std::make_unique<Program>();
  initial_->allocBuffer(1);
  initial_->allocEventBuffer();
  initial_->sampleRate = config.sampleRate;
  initial_->blockSize = config.blockSize;
  current_ = initial_.get();
  splitter_.prepare(config.blockSize, kMaxChannels);
}

Engine::~Engine() {
  collectGarbage();
  if (Program* p = pending_.exchange(nullptr)) delete p;
  if (current_ != initial_.get()) delete current_;
}

Result Engine::commit() {
  CompileOutput out = compileGraph(model_, registry_, instances_, revision_ + 1, config_.sampleRate, config_.blockSize);
  if (!out.program) {
    const auto colon = out.error.find(':');
    return Result::fail(out.error.substr(0, colon), out.error.substr(colon + 2));
  }
  ++revision_;
  // If the audio thread has not consumed the previous pending program yet, it is safe to delete here:
  // only this thread ever stores into pending_, and the audio thread takes ownership with exchange().
  if (Program* stale = pending_.exchange(out.program.release(), std::memory_order_acq_rel)) delete stale;
  collectGarbage();
  return {};
}

Result Engine::setParam(const std::string& node, const std::string& param, float value) {
  Result r = model_.setParam(registry_, node, param, value);
  if (!r) return r;
  const ModuleInstance* inst = instances_.find(node);
  if (!inst) return {};   // not compiled yet; the value will be applied on the next acquire
  const int32_t idx = inst->type->findParam(param);
  const ParamDesc& d = inst->type->desc->params[idx];
  if (!params_.try_enqueue(ParamChange{inst->serial, static_cast<uint32_t>(idx), paramNormalize(d, value)}))
    return Result::fail("E_QUEUE_FULL", "param queue full");
  return {};
}

void Engine::collectGarbage() {
  Program* p = nullptr;
  while (retired_.try_dequeue(p)) if (p != initial_.get()) delete p;
}

void Engine::swapIfPending() {
  Program* next = pending_.exchange(nullptr, std::memory_order_acq_rel);
  if (!next) return;
  if (!retired_.try_enqueue(current_)) {   // retire queue full: put the new one back and try next block
    pending_.store(next, std::memory_order_release);
    return;
  }
  current_ = next;
}

void Engine::drainParams() {
  ParamChange c;
  while (params_.try_dequeue(c)) {
    const int32_t node = current_->findNodeBySerial(c.serial);
    if (node < 0) continue;   // module no longer in the program
    current_->nodes[static_cast<size_t>(node)].inst->params[c.param].setTargetNorm(c.norm);
  }
}

void Engine::renderBlock(float* const* out, uint32_t channels, uint32_t numFrames, const TransportSnapshot& t) {
  swapIfPending();
  drainParams();
  AudioBus bus;
  bus.channels = channels < kMaxChannels ? channels : kMaxChannels;
  bus.frames = numFrames;
  for (uint32_t c = 0; c < bus.channels; ++c) { bus.ch[c] = bus_[c].data(); std::fill_n(bus.ch[c], numFrames, 0.f); }
  scheduler_.run(*current_, numFrames, t, &bus);
  for (uint32_t c = 0; c < channels; ++c) std::copy_n(bus_[c < kMaxChannels ? c : kMaxChannels - 1].data(), numFrames, out[c]);
}

void Engine::renderInterleaved(float* out, uint32_t frames, uint32_t channels, const TransportSnapshot& t) {
  splitter_.render(out, frames, [&](float* block, uint32_t n) {
    std::array<float*, kMaxChannels> planar{};
    for (uint32_t c = 0; c < kMaxChannels; ++c) planar[c] = interleavedScratch_.data() + static_cast<size_t>(c) * kMaxBlockSize;
    renderBlock(planar.data(), kMaxChannels, n, t);
    for (uint32_t i = 0; i < n; ++i)
      for (uint32_t c = 0; c < channels; ++c) block[i * channels + c] = planar[c < kMaxChannels ? c : kMaxChannels - 1][i];
  });
}

}  // namespace pg
```

Note on `renderInterleaved`: the splitter was prepared with `kMaxChannels` interleaved channels; when the device has more than 2 channels the extra channels duplicate the last one. `BlockSplitter::prepare` must be called with the device's channel count in phase 4's device wiring; for this task, tests use 2 channels. The lambda captures by reference and is a `std::function` constructed per call, which allocates only if the closure exceeds the small-buffer size. Three references fit in libc++'s small buffer, so the RT test stays clean; if the `[rt]` test reports violations here, hoist the lambda into a member `BlockSplitter::BlockFn` built once in the constructor.

- [ ] **Step 4: Run the tests** — `npm run engine:test`: all `[engine]` tests pass, including the `[rt]` one.

- [ ] **Step 5: Commit**

```bash
git add engine
git commit -m "feat(engine): Engine with atomic program swap, retire queue and lock-free param changes"
```

---

### Task 14: `io.audioOut` module, JSON patch loader, offline renderer, `--render`

**Files:**
- Create: `engine/src/modules/AudioOut.cpp`, `engine/src/modules/builtin.hpp`, `engine/src/modules/builtin.cpp`
- Create: `engine/src/render/PatchFile.hpp`, `engine/src/render/PatchFile.cpp`, `engine/src/render/OfflineRenderer.hpp`, `engine/src/render/OfflineRenderer.cpp`
- Create: `engine/tests/golden/const_to_out.json`
- Modify: `engine/src/app/main.cpp`
- Test: `engine/tests/test_render.cpp`

**Interfaces:**
- Produces: module `io.audioOut` (inputs `inL`, `inR` continuous mono; param `gain` [0,2] def 1 modulatable; flag `kModuleTerminal`), `void pg::registerBuiltinModules(Registry&)`.
- `pg::Result pg::loadPatchJson(const nlohmann::json&, const Registry&, GraphModel&)`; patch schema below. `pg::Result pg::loadPatchFile(const std::string& path, const Registry&, GraphModel&)`.
- `pg::RenderOptions { double seconds; uint32_t channels = 2; }`, `std::vector<float> pg::renderInterleaved(Engine&, const RenderOptions&)`, `bool pg::writeWav(const std::string& path, const std::vector<float>& interleaved, uint32_t channels, double sampleRate, std::string& error)`.
- CLI: `phasegrid-engine --render <patch.json> --seconds <n> --out <file.wav> [--sr 48000] [--block 64]`.

Patch JSON schema (identical to what the frontend will write in phase 11):
```json
{
  "schemaVersion": 1,
  "voiceCount": 1,
  "feedbackMode": "sample",
  "modules": [ { "id": "c", "type": "test.const", "params": { "value": 0.25 } } ],
  "edges": [ { "id": "e1", "from": { "module": "c", "port": "out" }, "to": { "module": "out", "port": "inL" } } ]
}
```
Unknown top-level keys (e.g. `x`, `y` positions inside modules) are ignored.

- [ ] **Step 1: Write the failing test and golden patch**

`engine/tests/golden/const_to_out.json`:
```json
{
  "schemaVersion": 1,
  "voiceCount": 1,
  "feedbackMode": "sample",
  "modules": [
    { "id": "c", "type": "test.const", "params": { "value": 0.25 }, "x": 10, "y": 20 },
    { "id": "out", "type": "io.audioOut", "params": { "gain": 1 } }
  ],
  "edges": [
    { "id": "e1", "from": { "module": "c", "port": "out" }, "to": { "module": "out", "port": "inL" } },
    { "id": "e2", "from": { "module": "c", "port": "out" }, "to": { "module": "out", "port": "inR" } }
  ]
}
```

`engine/tests/test_render.cpp`:
```cpp
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cstdio>
#include <filesystem>
#include "core/Engine.hpp"
#include "modules/TestModules.hpp"
#include "modules/builtin.hpp"
#include "render/OfflineRenderer.hpp"
#include "render/PatchFile.hpp"

TEST_CASE("loadPatchFile + renderInterleaved produce the expected samples", "[render]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  pg::test::registerTestModules(reg);
  pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
  REQUIRE(pg::loadPatchFile(std::string(PG_TEST_DIR) + "/golden/const_to_out.json", reg, engine.model()));
  REQUIRE(engine.commit());
  std::vector<float> out = pg::renderInterleaved(engine, pg::RenderOptions{0.01, 2});
  REQUIRE(out.size() == 480 * 2);
  REQUIRE(out[0] == Catch::Approx(0.25f));
  REQUIRE(out[1] == Catch::Approx(0.25f));
  REQUIRE(out[out.size() - 1] == Catch::Approx(0.25f));

  const std::string wav = (std::filesystem::temp_directory_path() / "pg_render_test.wav").string();
  std::string err;
  REQUIRE(pg::writeWav(wav, out, 2, 48000.0, err));
  REQUIRE(std::filesystem::file_size(wav) > 44);
  std::remove(wav.c_str());
}

TEST_CASE("loadPatchJson reports schema errors", "[render]") {
  pg::Registry reg; pg::registerBuiltinModules(reg);
  pg::GraphModel m;
  REQUIRE(pg::loadPatchJson(nlohmann::json::parse(R"({"schemaVersion": 99, "modules": [], "edges": []})"), reg, m).code == "E_SCHEMA");
  REQUIRE(pg::loadPatchJson(nlohmann::json::parse(R"({"schemaVersion": 1, "modules": [{"id":"a","type":"nope"}], "edges": []})"), reg, m).code == "E_UNKNOWN_TYPE");
  REQUIRE(pg::loadPatchJson(nlohmann::json::parse(R"({"schemaVersion": 1, "modules": [], "edges": [], "feedbackMode": "block"})"), reg, m));
  REQUIRE(m.feedbackMode == pg::FeedbackMode::Block);
}
```

- [ ] **Step 2: Run to verify failure** — compile errors (headers missing).

- [ ] **Step 3: Write the module and registration list**

`engine/src/modules/builtin.hpp`:
```cpp
#pragma once
#include "core/Registry.hpp"
namespace pg {
/// Registers every built-in module. Add one line per new module file.
void registerBuiltinModules(Registry& registry);
}
```

`engine/src/modules/AudioOut.cpp`:
```cpp
#include "core/Module.hpp"

namespace pg::modules {

namespace {
const PortDesc kIn[] = {
  {"inL", "In L", PortKind::Continuous, 1, SignalRole::Audio, "Left channel"},
  {"inR", "In R", PortKind::Continuous, 1, SignalRole::Audio, "Right channel"},
};
const ParamDesc kParams[] = {
  {"gain", "Gain", 0.f, 2.f, 1.f, ParamUnit::Ratio, ParamCurve::Linear, kParamModulatable, nullptr, 0, "slider", nullptr, "Output gain"},
};

class AudioOut final : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    if (!c.outputBus) return;
    const float* l = c.in(0).read(0);
    const float* r = c.in(1).read(0);
    const ParamView g = c.param(0);
    float* outL = c.outputBus->ch[0];
    float* outR = c.outputBus->channels > 1 ? c.outputBus->ch[1] : c.outputBus->ch[0];
    for (uint32_t i = 0; i < c.numFrames; ++i) { outL[i] += l[i] * g.at(i); outR[i] += r[i] * g.at(i); }
  }
};
}  // namespace

const ModuleDescriptor kAudioOut{kModuleAbiVersion, "io.audioOut", "Audio Out", "io",
  "Sends stereo audio to the engine output. Voices are summed.",
  kIn, countOf(kIn), nullptr, 0, kParams, countOf(kParams), kModuleTerminal, 0, [] () -> Module* { return new AudioOut(); }};

}  // namespace pg::modules
```

`engine/src/modules/builtin.cpp`:
```cpp
#include "modules/builtin.hpp"
#include <stdexcept>

namespace pg {
namespace modules { extern const ModuleDescriptor kAudioOut; }

void registerBuiltinModules(Registry& r) {
  const ModuleDescriptor* all[] = {
    &modules::kAudioOut,
  };
  for (const ModuleDescriptor* d : all)
    if (auto err = r.add(*d)) throw std::runtime_error("registerBuiltinModules: " + *err);
}
}  // namespace pg
```

- [ ] **Step 4: Write the patch loader**

`engine/src/render/PatchFile.hpp`:
```cpp
#pragma once
#include <nlohmann/json.hpp>
#include <string>
#include "core/GraphModel.hpp"

namespace pg {
/// Replaces the model's contents with the patch. Ignores unknown keys.
Result loadPatchJson(const nlohmann::json& j, const Registry& registry, GraphModel& model);
Result loadPatchFile(const std::string& path, const Registry& registry, GraphModel& model);
}
```

`engine/src/render/PatchFile.cpp`:
```cpp
#include "render/PatchFile.hpp"
#include <fstream>

namespace pg {

Result loadPatchJson(const nlohmann::json& j, const Registry& registry, GraphModel& model) {
  if (!j.is_object() || j.value("schemaVersion", 0) != 1) return Result::fail("E_SCHEMA", "unsupported schemaVersion");
  GraphModel fresh;
  if (Result r = fresh.setVoiceCount(j.value("voiceCount", 1u)); !r) return r;
  const std::string mode = j.value("feedbackMode", "sample");
  if (mode != "sample" && mode != "block") return Result::fail("E_SCHEMA", "feedbackMode must be sample|block");
  fresh.feedbackMode = mode == "block" ? FeedbackMode::Block : FeedbackMode::Sample;

  for (const auto& m : j.value("modules", nlohmann::json::array())) {
    NodeModel n;
    n.id = m.value("id", "");
    n.type = m.value("type", "");
    if (n.id.empty() || n.type.empty()) return Result::fail("E_SCHEMA", "module needs id and type");
    for (const auto& [k, v] : m.value("params", nlohmann::json::object()).items()) {
      if (!v.is_number()) return Result::fail("E_SCHEMA", "param " + k + " must be a number");
      n.params[k] = v.get<float>();
    }
    if (Result r = fresh.addNode(registry, std::move(n)); !r) return r;
  }
  for (const auto& e : j.value("edges", nlohmann::json::array())) {
    EdgeModel edge;
    edge.id = e.value("id", "");
    edge.fromNode = e.value("from", nlohmann::json::object()).value("module", "");
    edge.fromPort = e.value("from", nlohmann::json::object()).value("port", "");
    edge.toNode = e.value("to", nlohmann::json::object()).value("module", "");
    edge.toPort = e.value("to", nlohmann::json::object()).value("port", "");
    if (edge.id.empty()) return Result::fail("E_SCHEMA", "edge needs id");
    if (Result r = fresh.addEdge(registry, std::move(edge)); !r) return r;
  }
  model = std::move(fresh);
  return {};
}

Result loadPatchFile(const std::string& path, const Registry& registry, GraphModel& model) {
  std::ifstream in(path);
  if (!in) return Result::fail("E_IO", "cannot open " + path);
  nlohmann::json j = nlohmann::json::parse(in, nullptr, false);
  if (j.is_discarded()) return Result::fail("E_SCHEMA", "invalid JSON in " + path);
  return loadPatchJson(j, registry, model);
}

}  // namespace pg
```

- [ ] **Step 5: Write the offline renderer**

`engine/src/render/OfflineRenderer.hpp`:
```cpp
#pragma once
#include <string>
#include <vector>
#include "core/Engine.hpp"

namespace pg {
struct RenderOptions {
  double seconds = 1.0;
  uint32_t channels = 2;
};
/// Renders with a stopped transport at the engine's sample rate. Interleaved output.
std::vector<float> renderInterleaved(Engine& engine, const RenderOptions& options);
bool writeWav(const std::string& path, const std::vector<float>& interleaved, uint32_t channels, double sampleRate, std::string& error);
}
```

`engine/src/render/OfflineRenderer.cpp`:
```cpp
#include "render/OfflineRenderer.hpp"
#include <cmath>
#include "miniaudio.h"

namespace pg {

std::vector<float> renderInterleaved(Engine& engine, const RenderOptions& o) {
  const uint32_t block = engine.config().blockSize;
  const uint64_t total = static_cast<uint64_t>(std::llround(o.seconds * engine.config().sampleRate));
  std::vector<float> out(static_cast<size_t>(total) * o.channels);
  std::vector<float> planar(static_cast<size_t>(kMaxChannels) * block);
  float* ptrs[kMaxChannels];
  for (uint32_t c = 0; c < kMaxChannels; ++c) ptrs[c] = planar.data() + static_cast<size_t>(c) * block;
  TransportSnapshot t;
  for (uint64_t pos = 0; pos < total; pos += block) {
    const uint32_t n = static_cast<uint32_t>(std::min<uint64_t>(block, total - pos));
    t.samplePos = pos;
    engine.renderBlock(ptrs, kMaxChannels, n, t);
    for (uint32_t i = 0; i < n; ++i)
      for (uint32_t c = 0; c < o.channels; ++c)
        out[(pos + i) * o.channels + c] = ptrs[c < kMaxChannels ? c : kMaxChannels - 1][i];
  }
  return out;
}

bool writeWav(const std::string& path, const std::vector<float>& interleaved, uint32_t channels, double sampleRate, std::string& error) {
  ma_encoder_config cfg = ma_encoder_config_init(ma_encoding_format_wav, ma_format_f32, channels, static_cast<ma_uint32>(sampleRate));
  ma_encoder enc;
  if (ma_encoder_init_file(path.c_str(), &cfg, &enc) != MA_SUCCESS) { error = "cannot create " + path; return false; }
  ma_uint64 written = 0;
  const ma_uint64 frames = interleaved.size() / channels;
  const ma_result r = ma_encoder_write_pcm_frames(&enc, interleaved.data(), frames, &written);
  ma_encoder_uninit(&enc);
  if (r != MA_SUCCESS || written != frames) { error = "short write to " + path; return false; }
  return true;
}

}  // namespace pg
```

- [ ] **Step 6: Add `--render` to main.cpp**

Add includes `"core/Engine.hpp"`, `"modules/builtin.hpp"`, `"render/OfflineRenderer.hpp"`, `"render/PatchFile.hpp"`, `<string>`, and this function plus its dispatch line:
```cpp
static int runRender(int argc, char** argv) {
  std::string patch, out; double seconds = 2.0, sr = 48000.0; uint32_t block = 64;
  for (int i = 2; i < argc; ++i) {
    const std::string a = argv[i];
    auto next = [&](double& v) { if (i + 1 < argc) v = std::atof(argv[++i]); };
    if (a == "--seconds") next(seconds);
    else if (a == "--sr") next(sr);
    else if (a == "--block") { double b = 64; next(b); block = static_cast<uint32_t>(b); }
    else if (a == "--out" && i + 1 < argc) out = argv[++i];
    else if (patch.empty()) patch = a;
  }
  if (patch.empty() || out.empty()) { std::fprintf(stderr, "usage: --render <patch.json> --out <file.wav> [--seconds N] [--sr N] [--block N]\n"); return 2; }
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  pg::Engine engine{reg, pg::EngineConfig{sr, block}};
  if (pg::Result r = pg::loadPatchFile(patch, reg, engine.model()); !r) { std::fprintf(stderr, "%s: %s\n", r.code.c_str(), r.message.c_str()); return 1; }
  if (pg::Result r = engine.commit(); !r) { std::fprintf(stderr, "%s: %s\n", r.code.c_str(), r.message.c_str()); return 1; }
  const std::vector<float> data = pg::renderInterleaved(engine, pg::RenderOptions{seconds, 2});
  std::string err;
  if (!pg::writeWav(out, data, 2, sr, err)) { std::fprintf(stderr, "%s\n", err.c_str()); return 1; }
  std::printf("rendered %zu frames to %s\n", data.size() / 2, out.c_str());
  return 0;
}
// in main():  if (argc >= 2 && std::strcmp(argv[1], "--render") == 0) return runRender(argc, argv);
```
Update `usage()` to list `--render`.

- [ ] **Step 7: Run the tests and a manual render**

```bash
npm run engine:test
cat > /tmp/sine_patch.json <<'EOF'
{ "schemaVersion": 1, "modules": [ { "id": "out", "type": "io.audioOut" } ], "edges": [] }
EOF
./build/engine/phasegrid-engine --render /tmp/sine_patch.json --seconds 1 --out /tmp/silence.wav
```
Expected: tests pass; the render prints `rendered 48000 frames`. (An audible patch needs the oscillator from the next plan; test modules are not registered in the CLI.)

- [ ] **Step 8: Commit**

```bash
git add engine
git commit -m "feat(engine): io.audioOut, JSON patch loader, offline WAV renderer and --render CLI"
```

---

### Task 15: Engine documentation and module walkthrough

**Files:**
- Create: `docs/engine.md`, `docs/adding-a-module.md`
- Modify: `README.md` (link the docs)

- [ ] **Step 1: Write docs/engine.md**

```markdown
# Engine

C++20 process. One message thread (socket/commands, compiles), one audio thread (device callback).

## Threads and RT rules
Audio-thread code = `Module::process`, `Scheduler::run`, `Engine::renderBlock`, param drain, program swap.
In that code: no `new`/`delete`/containers that grow, no locks, no syscalls, no exceptions, no logging, no `std::function` construction.
Allocate in `Module::prepare` only. `engine/tests/test_rt_alloc.cpp` and every `[rt]` test fail on any global allocation.

## Signals
- Continuous ports: planar float, nominal ±1, 1 or 2 channels. Mono broadcasts on read. Any output connects to any input; fan-in sums.
- Event ports: `EventBuffer` of frame-ordered `Event {frame, type, channel, noteId, a, b, c}`. Fan-in merges by frame.
- Conventions (`core/Conventions.hpp`): pitch `hz = 261.6256 * 2^(v*10)`, gate `> 0`, phase 0..1.

## Params
Each `ParamDesc` has min/max/default in display units and a curve. `ParamState` stores the normalized target and a 5 ms one-pole smoother.
Modulatable params get an implicit input port `param:<id>`; effective value = `denormalize(clamp(knobNorm + signal))`.
Modules read `ctx.param(i).at(frame)` and never see whether the value is constant, ramping or modulated.

## Program and hot-swap
`GraphModel` → `compileGraph` → `Program` (buffers, event buffers, ops, feedback states) on the message thread.
`Engine::commit` publishes with one atomic exchange; the audio thread adopts it at the next block and retires the old one to an SPSC queue that the message thread frees.
`InstanceTable` reuses a `ModuleInstance` when `(id, type)` is unchanged, so DSP state and params survive edits. Feedback delay memory is reused by edge id.
Param changes never trigger a compile: `Engine::setParam` enqueues `{serial, param, norm}`; the audio thread applies it by binary-searching the current program.

## Feedback
Tarjan SCCs. Nodes in an SCC (or with a self loop) form a cluster: `ClusterBegin … ClusterEnd`.
Inside a cluster the scheduler runs every op once per sample (`feedbackMode: sample`) or once per block (`block`).
Back edges (edge from a later to an earlier node in the cluster's DFS order) read from and write to a `FeedbackState`, giving an exact one-sample (or one-block) delay.

## Ops
`Sum{dst, argsStart, count}`, `Merge{dstEvt, argsStart, count}`, `FillParam{node, param, modBuf}`, `FeedbackRead{fb, dst}`,
`FeedbackWrite{fb, src}`, `ClearEvents{evt}`, `Process{node}`, `ClusterBegin{count}`, `ClusterEnd`.

## Tests
`npm run engine:test`. Suites: signal/event/param/registry/model (unit), scheduler (hand-built programs), graph (compiler), feedback, hotswap (Engine), render (JSON → WAV), rt (allocation guard).
Headless render: `./build/engine/phasegrid-engine --render patch.json --seconds 2 --out out.wav`.
```

- [ ] **Step 2: Write docs/adding-a-module.md**

```markdown
# Adding a module

1. Create `engine/src/modules/<Name>.cpp`. Declare ports and params as static C-layout arrays, a class deriving `VoicedModule<State>` with all mutable state in `State`, and a `const ModuleDescriptor k<Name>` in namespace `pg::modules`.
2. Add `&modules::k<Name>` to the list in `engine/src/modules/builtin.cpp` (and an `extern` line).
3. Run `npm run engine:test`. Add a null test (silence in → silence out) and, for oscillators, a spectral test.
4. No TypeScript changes: the catalog is generated from the descriptor and the UI renders from it.

Template:
```cpp
#include "core/Module.hpp"
namespace pg::modules {
namespace {
const PortDesc kIn[]  = {{"in", "In", PortKind::Continuous, 1, SignalRole::Any, ""}};
const PortDesc kOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Any, ""}};
const ParamDesc kParams[] = {{"amount", "Amount", 0.f, 1.f, 0.5f, ParamUnit::None, ParamCurve::Linear, kParamModulatable, nullptr, 0, "slider", nullptr, ""}};
struct State { float z = 0.f; };
class Example final : public VoicedModule<State> {
  void process(ProcessContext& c) override {
    State& s = st(c);
    const float* in = c.in(0).read(0); float* out = c.out(0).write(0); const ParamView amt = c.param(0);
    for (uint32_t i = 0; i < c.numFrames; ++i) { s.z += amt.at(i) * (in[i] - s.z); out[i] = s.z; }
  }
};
}  // namespace
const ModuleDescriptor kExample{kModuleAbiVersion, "fx.example", "Example", "fx", "One-pole smoother.",
  kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), 0, 0, [] () -> Module* { return new Example(); }};
}  // namespace pg::modules
```

Rules: no statics for state, no allocation in `process`, params are numeric only, `numFrames` can be 1 (feedback clusters).
```

- [ ] **Step 3: Link from README and commit**

Append to `README.md`:
```markdown
## Docs
- `docs/engine.md` — engine architecture and RT rules
- `docs/adding-a-module.md` — how to add a module
- `docs/superpowers/specs/` — design spec
```

```bash
git add docs README.md
git commit -m "docs: engine architecture and adding-a-module guide"
```

---

## Self-review against the spec (phases 0–2)

| Spec item | Task |
|---|---|
| Scaffold, toolchain, CI, `/shared` skeleton, docs stubs, LICENSE, CLAUDE.md | 1, 2, 15 |
| MiniaudioBackend, NullBackend, block splitter, `--tone`, NewGuard + `test_rt_alloc`, rtsan preset | 3, 4, 5, 2 |
| Signal / Event / Descriptor / Module / Registry (implicit param ports) | 6, 7, 8 |
| GraphModel mirror | 9 |
| Program / Scheduler / swap + retire / ParamQueue + Smoother | 10, 13, 7 |
| Compiler with SCC, per-sample clusters, one-sample delay, `feedbackMode` | 11, 12 |
| Instance reuse by `(id, type)`, FeedbackState reuse by edge id | 10, 12 |
| OfflineRenderer + `--render`, JSON patch format | 14 |
| `test_graph`, `test_feedback`, `test_hotswap`, `test_rt_alloc`, JSON → WAV | 11, 12, 13, 5, 14 |

Deferred to the next plan (phase 3+): the 14 DSP modules on DaisySP, `Oversampler`, `--catalog`, spectral tests, Storybook config, the N-API addon stub, telemetry slots (`ProcessContext::telemetry` is intentionally absent until phase 5).

Known limitations recorded for the next plans: events inside feedback clusters are passed whole-block; MIDI timing is block-quantized; `renderInterleaved` duplicates channel 2 onto extra device channels.
