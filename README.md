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

## Docs
- `docs/engine.md` — engine architecture, signal type and RT rules
- `docs/adding-a-module.md` — how to add a module
- `docs/superpowers/specs/` — design spec and amendments
- `engine/vendor/vital/NOTICE.md` — vendored DSP provenance and licensing
