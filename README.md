# duke-wasm — Duke Nukem 1 & 2 in the browser

Play **Duke Nukem** (1991) and **Duke Nukem II** (1993) directly in a web browser. 100%
client-side — no server, nothing uploaded.

- **Shareware plays instantly** — the freely-redistributable Apogee shareware ships with the site:
  Duke Nukem Episode 1 ("Shrapnel City") and the Duke Nukem II shareware episode.
- **Full/registered games** — own them? **Drag-and-drop your own data files** onto the page. They
  are assembled into a `.jsdos` bundle in-browser and never leave your machine. Dropping a full
  Duke Nukem 1 folder gives you all three episodes.

## How it works

The real DOS binaries run under [js-dos](https://js-dos.com) (DOSBox compiled to WebAssembly),
entirely in your browser tab.

### Supplying your own data

Drop **all** of the game's files (the whole folder):

| Game | Run | Files to drop |
|------|-----|---------------|
| Duke Nukem (Ep. 1/2/3) | `DN1.EXE` / `DN2.EXE` / `DN3.EXE` | the `DN?.EXE` + every `*.DN1` / `*.DN2` / `*.DN3` |
| Duke Nukem II          | `NUKEM2.EXE` | `NUKEM2.EXE` + `NUKEM2.CMP` + `NUKEM2.F*` |

The launcher detects which game(s) the files contain and builds the bundle(s) in your browser —
a full Duke Nukem 1 folder produces a Play button for each episode.

## Controls

- **Keyboard:** arrows move · **Ctrl** = jump · **Alt** = fire. (Both Duke games share this scheme.)
- **Touch** (phones/tablets, or force it in Settings): the screen splits — game on top, an
  on-screen joystick + Fire/Jump buttons on the bottom.
- **Settings:** aspect ratio, crisp vs. smooth pixels, touch-controls mode, and DOSBox vs.
  DOSBox-X (real-time save/load states).
- **Saves persist** automatically in your browser (IndexedDB, per game) and survive reloads.

## Project layout

```
index.html          launcher UI
css/app.css         styling
js/app.js           launch logic + in-browser .jsdos bundle builder
js/fflate.min.js    vendored zip library (assembles bundles client-side)
games/duke1.jsdos   prebuilt Duke Nukem Ep.1 shareware bundle (free)
games/duke2.jsdos   prebuilt Duke Nukem II shareware bundle (free)
docker/             entrypoint + nginx config for self-hosting
deploy/             docker-compose + reverse-proxy templates for box/pro
```

## GitHub Pages

The site is static — `git push`, enable **Pages** (Settings → Pages → Deploy from branch → `main`
/ root), done. The shareware plays instantly; registered games are bring-your-own-data.
(`.nojekyll` is present so the `.jsdos` bundles are served verbatim.)

```
python3 -m http.server 8087   # local dev → http://127.0.0.1:8087
```
(js-dos requires `http://`, not `file://`.)

## Self-hosting with Docker (server / kiosk mode)

A container image is published to Docker Hub as **`awkto/duke-wasm`** by GitHub Actions on every
`v*.*.*` tag (`:latest` tracks the newest release).

Mount a directory of your own Duke files at `/data`. On startup the container detects each game,
builds its `.jsdos` bundle, and writes `games/manifest.json` — the launcher then shows **only the
available games** as one-click buttons and **hides the upload UI** entirely. Layout under `/data`
is one subdir per game (recommended) or flat:

```
/data/duke1/DN1.EXE DN2.EXE DN3.EXE *.DN1 *.DN2 *.DN3 ...   # full Duke Nukem 1 (3 episodes)
/data/duke2/NUKEM2.EXE NUKEM2.CMP NUKEM2.F* ...             # registered Duke Nukem II
```

```bash
docker run -d --name duke-wasm --restart unless-stopped \
  -p 127.0.0.1:5028:80 \
  -v /srv/duke-data:/data:ro \
  awkto/duke-wasm:latest
```

Any game `/data` doesn't supply falls back to the bundled shareware. Registered data is never
baked into the image — it only ever lives in your mounted `/data`.

### Production deployment (box.dnsif.ca / pro.dnsif.ca)

See [`deploy/README.md`](deploy/README.md): `docker-compose` per host, an nginx reverse-proxy
vhost (TLS via the per-host wildcard cert), and wildcard DNS. On those instances the full retail
Duke games live in the mounted `/data`, so every episode runs with no uploads and the
bring-your-own UI is hidden.

## Licensing

- **This launcher code** (everything except `games/` and `js/fflate.min.js`) is MIT — see
  [`LICENSE`](LICENSE).
- **`js/fflate.min.js`** is [fflate](https://github.com/101arrowz/fflate), MIT.
- **js-dos** is loaded from its CDN under its own (GPL) license; it is not redistributed here.
- **Duke Nukem** is © Apogee / 3D Realms. Only the freely-redistributable shareware is included.
  **Do not commit registered Duke data to this repository.**
