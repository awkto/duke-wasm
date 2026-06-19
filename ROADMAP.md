# Roadmap

## Path 1 — js-dos baseline ✅ (current)

Real DOS binaries under DOSBox-WASM, fully client-side.

- [x] Duke Nukem Ep.1 + Duke Nukem II shareware playable from prebuilt `.jsdos` bundles
- [x] Drag-drop / file-picker → in-browser `.jsdos` bundle for the registered games
- [x] Per-game auto-detection (`DN?.EXE`+`*.DN?` → Duke Nukem 1 episodes; `NUKEM2.EXE`+`NUKEM2.CMP` → Duke Nukem II); a full DN1 folder yields all three episodes
- [x] Static site, deployable to GitHub Pages
- [x] Save-game persistence across reloads (IndexedDB snapshot, keyed per game)
- [x] Settings panel: aspect ratio + crisp/smooth pixels + DOSBox/DOSBox-X
- [x] Mobile/touch on-screen controls (joystick + Fire/Jump)
- [x] Server/kiosk mode: container detects full games in a mounted `/data` and hides the upload UI
- [x] Production deployment kit (compose + nginx reverse proxy) for box.dnsif.ca / pro.dnsif.ca
- [ ] Per-game cycles tuning in the settings panel (DN1 is speed-sensitive)
- [ ] Optional cross-origin isolation (COOP/COEP) for SharedArrayBuffer (smoother audio)

## Path 2 — native-web port (idea, separate branch)

Duke Nukem II has a modern open-source reimplementation, [Rigel Engine](https://github.com/lethal-guitar/RigelEngine),
which can be compiled to WebAssembly with Emscripten for a crisp, native-web build (it still needs
the original game data). Tracked here as a possible future Path 2 for DN2.
