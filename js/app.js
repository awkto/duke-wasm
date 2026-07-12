/*
 * Duke Nukem 1 / 2 launcher (js-dos baseline).
 *
 * - Shareware ships prebuilt and plays instantly: Duke Nukem Episode 1
 *   (games/duke1.jsdos) and Duke Nukem II shareware (games/duke2.jsdos), both
 *   freely redistributable Apogee shareware.
 * - Full/registered data (Duke Nukem episodes 2 & 3, registered Duke Nukem II):
 *   the user supplies their own files, assembled into a .jsdos bundle entirely
 *   in the browser (nothing is uploaded). Dropping a full Duke Nukem 1 folder
 *   yields all three episodes.
 * - In server/kiosk mode (container with a mounted /data dir) the launcher shows
 *   only the games detected on the server and hides the upload UI.
 *
 * Wrapped in an IIFE: js-dos.js declares globals (including `var $`), so we keep
 * our own top-level names out of global scope.
 */

(function () {
"use strict";

// The Duke Nukem games. Duke Nukem 1 is three episode executables that share one
// data folder (each loads its own *.DN<n> set); Duke Nukem II is one game.
// `run` is the DOS executable; `detect` identifies the game from a set of
// (UPPERCASED) filenames; `need` is the checklist shown in the UI.
const GAMES = {
  duke1: {
    title: "Duke Nukem — Episode 1: Shrapnel City",
    short: "Duke Nukem (Ep. 1)",
    run: "DN1.EXE",
    detect: (set) => set.has("DN1.EXE") && [...set].some((n) => /\.DN1$/.test(n)),
    need: [["DN1.EXE", (set) => set.has("DN1.EXE")],
           ["*.DN1 episode data", (set) => [...set].some((n) => /\.DN1$/.test(n))]],
  },
  duke1ep2: {
    title: "Duke Nukem — Episode 2: Mission: Moonbase",
    short: "Duke Nukem (Ep. 2)",
    run: "DN2.EXE",
    detect: (set) => set.has("DN2.EXE") && [...set].some((n) => /\.DN2$/.test(n)),
    need: [["DN2.EXE", (set) => set.has("DN2.EXE")],
           ["*.DN2 episode data", (set) => [...set].some((n) => /\.DN2$/.test(n))]],
  },
  duke1ep3: {
    title: "Duke Nukem — Episode 3: Trapped in the Future!",
    short: "Duke Nukem (Ep. 3)",
    run: "DN3.EXE",
    detect: (set) => set.has("DN3.EXE") && [...set].some((n) => /\.DN3$/.test(n)),
    need: [["DN3.EXE", (set) => set.has("DN3.EXE")],
           ["*.DN3 episode data", (set) => [...set].some((n) => /\.DN3$/.test(n))]],
  },
  duke2: {
    title: "Duke Nukem II",
    short: "Duke Nukem II",
    run: "NUKEM2.EXE",
    detect: (set) => set.has("NUKEM2.EXE") && set.has("NUKEM2.CMP"),
    need: [["NUKEM2.EXE", (set) => set.has("NUKEM2.EXE")],
           ["NUKEM2.CMP", (set) => set.has("NUKEM2.CMP")]],
  },
};
const GAME_KEYS = Object.keys(GAMES);

// All Duke games a set of filenames contains (a full Duke Nukem 1 folder yields
// duke1 + duke1ep2 + duke1ep3). Returns an array of keys, in registry order.
function detectGames(names) {
  const set = new Set(names);
  return GAME_KEYS.filter((k) => GAMES[k].detect(set));
}

// dosbox.conf used for user-supplied bundles. __RUNCMD__ is replaced with the
// game's executable. Kept in sync with the prebuilt games/*.jsdos configs.
const DOSBOX_CONF = `[sdl]
autolock=false
fullscreen=false
output=surface
mapperfile=mapper-jsdos.map
usescancodes=true
[dosbox]
machine=svga_s3
memsize=16
[cpu]
core=auto
cputype=auto
cycles=auto
cycleup=10
cycledown=20
[mixer]
nosound=false
rate=44100
blocksize=1024
prebuffer=20
[render]
frameskip=0
aspect=false
scaler=none
[sblaster]
sbtype=sb16
sbbase=220
irq=7
dma=1
hdma=5
sbmixer=true
oplmode=auto
oplemu=default
oplrate=44100
[speaker]
pcspeaker=true
pcrate=44100
[dos]
xms=true
ems=true
umb=true
keyboardlayout=auto
[autoexec]
echo off
mount c .
c:
__RUNCMD__
`;

let dosCi = null;           // running js-dos instance
let gameCi = null;          // emulator command interface (for sending key events)
let pendingFiles = null;    // [{name, data:Uint8Array}] from the BYO picker
const launchable = {};      // key -> bundle url (server games + bundled demos) for deep-links
let currentKey = null;      // key of the running game (for autosave)
let savedBlobUrl = null;    // object URL of a snapshot we booted from
let saveTimer = null;       // periodic autosave interval

const $ = (id) => document.getElementById(id);

// ---- persistent saves (self-managed) ---------------------------------------
// js-dos autoSave is unreliable here, so we snapshot the emulator filesystem
// (ci.persist(false) → a standalone .jsdos bundle holding the game's saves +
// config) into our own IndexedDB, keyed per game. We boot from that snapshot
// next time so progress is restored, and the launcher can Download/Upload/Delete it.
const SAVE_DB = "duke-saves";
const SAVE_STORE = "blobs";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(SAVE_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(SAVE_STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function saveGet(key) {
  try { const db = await idbOpen();
    return await new Promise((res) => {
      const t = db.transaction(SAVE_STORE, "readonly").objectStore(SAVE_STORE).get(key);
      t.onsuccess = () => res(t.result || null); t.onerror = () => res(null);
    });
  } catch (_) { return null; }
}
async function savePut(key, blob) {
  try { const db = await idbOpen();
    return await new Promise((res) => {
      const t = db.transaction(SAVE_STORE, "readwrite").objectStore(SAVE_STORE).put(blob, key);
      t.onsuccess = () => res(true); t.onerror = () => res(false);
    });
  } catch (_) { return false; }
}
async function saveDelete(key) {
  try { const db = await idbOpen();
    await new Promise((res) => {
      const t = db.transaction(SAVE_STORE, "readwrite").objectStore(SAVE_STORE).delete(key);
      t.onsuccess = () => res(); t.onerror = () => res();
    });
  } catch (_) {}
}
async function saveListKeys() {
  try { const db = await idbOpen();
    return await new Promise((res) => {
      const t = db.transaction(SAVE_STORE, "readonly").objectStore(SAVE_STORE).getAllKeys();
      t.onsuccess = () => res(t.result || []); t.onerror = () => res([]);
    });
  } catch (_) { return []; }
}

let capturing = false;
async function captureSave(key) {
  if (!gameCi || typeof gameCi.persist !== "function" || capturing || !key) return;
  capturing = true;
  try {
    const u = await gameCi.persist(false);
    if (u && u.length) await savePut(key, new Blob([u], { type: "application/octet-stream" }));
  } catch (_) {} finally { capturing = false; }
}

// ---- settings (persisted in localStorage) ----------------------------------

const SETTING_DEFAULTS = { aspect: "4/3", rendering: "pixelated", touch: "auto", engine: "dosbox", filter: "scanlines" };
const getSetting = (k) => localStorage.getItem("duke." + k) || SETTING_DEFAULTS[k];
const setSetting = (k, v) => localStorage.setItem("duke." + k, v);

function touchEnabled() {
  const mode = getSetting("touch");
  if (mode === "on") return true;
  if (mode === "off") return false;
  return window.matchMedia("(pointer: coarse)").matches; // auto
}

// ---- visual filters (CRT / scanlines) --------------------------------------
// Two render paths, both into a WebGL canvas sized to the game canvas:
//  • OVERLAY (default, zero-cost): a static multiplier drawn once and composited
//    via mix-blend-mode:multiply. Can't move pixels, so scanlines/mask/vignette
//    only. Pitch is locked to the EGA 320x200 grid so lines sit on game rows.
//  • SAMPLE (curved): js-dos frames can't be read directly, but captureStream
//    taps the compositor output — we feed that into a <video>, upload it as a
//    texture every frame and re-render it WARPED (real barrel curvature) with
//    scanlines/mask/vignette baked in. Our opaque canvas then covers the flat
//    original. Costs ~1 frame of display latency + 1 upload+draw per frame, only
//    while a sampling filter is selected; the emulator (worker) is unaffected.
const GAME_W = 320, GAME_H = 200;        // classic 320x200 DOS resolution
const FILTERS = {
  off:       null,
  scanlines: { type: 1, scan: 0.45, mask: 0,    vig: 0,    css: "" },
  crt:       { type: 3, scan: 0.45, mask: 0.18, vig: 0.45, css: "" },
  curved:    { sample: true, scan: 0.42, mask: 0.16, vig: 0.50, curve: 0.12, css: "" },
  rgb:       { type: 2, scan: 0,    mask: 0.22, vig: 0,    css: "" },
  soft:      { type: 1, scan: 0.30, mask: 0,    vig: 0,    css: "blur(0.6px) saturate(1.06)" },
  amber:     { type: 1, scan: 0.42, mask: 0,    vig: 0.25, css: "grayscale(1) sepia(1) hue-rotate(-18deg) saturate(3.2) brightness(1.05)" },
  green:     { type: 1, scan: 0.42, mask: 0,    vig: 0.25, css: "grayscale(1) sepia(1) hue-rotate(72deg) saturate(2.6) brightness(1.04)" },
};
let crtStop = null;     // resize/poll observer teardown
let crtGL = null;       // { gl, buf, overlay, sample, tex }
let crtRAF = 0;         // sampling render-loop handle
let crtVideo = null, crtStream = null;

const CRT_VS = `attribute vec2 aPos; varying vec2 vUv;
  void main(){ vUv = vec2(aPos.x*0.5+0.5, 1.0-(aPos.y*0.5+0.5)); gl_Position = vec4(aPos,0.0,1.0); }`;
// Overlay: outputs a multiplier (composited via mix-blend-mode:multiply).
const CRT_FS_OVERLAY = `precision highp float; varying vec2 vUv;
  uniform vec2 uGame; uniform int uFilter; uniform float uScan; uniform float uMask; uniform float uVig;
  void main(){
    vec3 m = vec3(1.0); vec2 uv = vUv;
    if (uFilter==1 || uFilter==3){ float s=sin(3.14159265*uv.y*uGame.y); m*=mix(1.0-uScan,1.0,s*s); }
    if (uFilter==2 || uFilter==3){ float ph=mod(floor(uv.x*uGame.x),3.0); vec3 t=vec3(1.0-uMask);
      if(ph<0.5)t.r=1.0; else if(ph<1.5)t.g=1.0; else t.b=1.0; m*=t; }
    if (uVig>0.0){ vec2 p=uv*2.0-1.0; m*=1.0-uVig*dot(p,p)*0.5; }
    gl_FragColor = vec4(m, 1.0);
  }`;
// Sample: warps the captured game texture (real curvature) + bakes in the CRT look.
const CRT_FS_SAMPLE = `precision highp float; varying vec2 vUv;
  uniform sampler2D uTex; uniform vec2 uGame; uniform float uScan; uniform float uMask; uniform float uVig; uniform float uCurve;
  void main(){
    vec2 p = vUv*2.0-1.0;
    p *= 1.0 + uCurve*dot(p,p);                       // barrel warp the SAMPLE coords -> pixels bend
    vec2 uv = p*0.5+0.5;
    if (uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){ gl_FragColor=vec4(0.0,0.0,0.0,1.0); return; }
    vec3 c = texture2D(uTex, uv).rgb;
    float s=sin(3.14159265*uv.y*uGame.y); c*=mix(1.0-uScan,1.0,s*s);
    float ph=mod(floor(uv.x*uGame.x),3.0); vec3 t=vec3(1.0-uMask);
    if(ph<0.5)t.r=1.0; else if(ph<1.5)t.g=1.0; else t.b=1.0; c*=t;
    c*=1.0-uVig*dot(p,p)*0.5;
    gl_FragColor = vec4(c, 1.0);
  }`;

function crtProgram(gl, fs) {
  const mk = (ty, src) => { const sh = gl.createShader(ty); gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.warn("CRT shader:", gl.getShaderInfoLog(sh)); return null; } return sh; };
  const v = mk(gl.VERTEX_SHADER, CRT_VS), f = mk(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const prog = gl.createProgram(); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn("CRT link:", gl.getProgramInfoLog(prog)); return null; }
  return { prog, loc: gl.getAttribLocation(prog, "aPos"), uni: {
    game: gl.getUniformLocation(prog, "uGame"), filter: gl.getUniformLocation(prog, "uFilter"),
    scan: gl.getUniformLocation(prog, "uScan"), mask: gl.getUniformLocation(prog, "uMask"),
    vig: gl.getUniformLocation(prog, "uVig"), curve: gl.getUniformLocation(prog, "uCurve"),
    tex: gl.getUniformLocation(prog, "uTex"),
  } };
}

function crtInit(canvas) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const overlay = crtProgram(gl, CRT_FS_OVERLAY), sample = crtProgram(gl, CRT_FS_SAMPLE);
  if (!overlay || !sample) return null;
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // No UNPACK_FLIP_Y: the vertex shader already flips Y (vUv.y=0 at top), so an
  // unflipped texture upload maps screen-top -> game-top correctly.
  return { gl, buf, overlay, sample, tex };
}

function crtBind(p) {
  const gl = crtGL.gl;
  gl.useProgram(p.prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, crtGL.buf);
  gl.enableVertexAttribArray(p.loc);
  gl.vertexAttribPointer(p.loc, 2, gl.FLOAT, false, 0, 0);
}

// Match the overlay canvas to the game canvas (CSS box + backing at full DPR).
function crtSize(cv, game) {
  const r = game.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  cv.style.left = r.left + "px"; cv.style.top = r.top + "px";
  cv.style.width = r.width + "px"; cv.style.height = r.height + "px";
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }   // resize keeps the GL context/resources
  return { w, h };
}

function crtStopSample() {
  if (crtRAF) { cancelAnimationFrame(crtRAF); crtRAF = 0; }
  if (crtStream) { try { crtStream.getTracks().forEach((t) => t.stop()); } catch (_) {} crtStream = null; }
  if (crtVideo) { try { crtVideo.pause(); crtVideo.srcObject = null; } catch (_) {} crtVideo = null; }
}

function renderCrt() {
  const cv = $("crt-canvas");
  const gameCanvas = document.querySelector("#dos canvas");
  if (!cv || !gameCanvas) return;
  // Soft/crisp pixels ride here too (live), so it combines with any overlay and
  // updates without relaunching — on mobile the filter dropdown drives it.
  gameCanvas.style.imageRendering = getSetting("rendering");
  const def = FILTERS[getSetting("filter")];
  if (def && def.sample && crtRAF) return;     // sample loop already running & self-sizing
  crtStopSample();
  // Colour-shift / blur ride on the game canvas's own CSS filter.
  gameCanvas.style.filter = (def && def.css) || "";
  cv.style.mixBlendMode = (def && def.sample) ? "normal" : "multiply";
  if (!def) { cv.classList.remove("on"); return; }
  const size = crtSize(cv, gameCanvas);
  if (!size) return;
  if (!crtGL) crtGL = crtInit(cv);
  if (!crtGL) { cv.classList.remove("on"); return; }
  const { gl } = crtGL;

  if (def.sample) { cv.classList.add("on"); startCrtSampleLoop(cv, gameCanvas, def); return; }
  if (!def.type) { cv.classList.remove("on"); return; }   // CSS-only filter, no overlay

  crtBind(crtGL.overlay);
  const u = crtGL.overlay.uni;
  gl.viewport(0, 0, size.w, size.h);
  gl.uniform2f(u.game, GAME_W, GAME_H);
  gl.uniform1i(u.filter, def.type);
  gl.uniform1f(u.scan, def.scan);
  gl.uniform1f(u.mask, def.mask);
  gl.uniform1f(u.vig, def.vig);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  cv.classList.add("on");
}

// Capture the game and re-render it warped, every frame, into our (opaque) canvas
// which covers the flat original. Only used by sampling filters (curved).
function startCrtSampleLoop(cv, gameCanvas, def) {
  const gl = crtGL.gl;
  try {
    crtStream = gameCanvas.captureStream();
    crtVideo = document.createElement("video");
    crtVideo.muted = true; crtVideo.playsInline = true; crtVideo.srcObject = crtStream;
    crtVideo.play().catch(() => {});
  } catch (e) {
    console.warn("CRT capture failed:", e);
    cv.classList.remove("on"); cv.style.mixBlendMode = "multiply"; return;
  }
  const u = crtGL.sample.uni;
  const draw = () => {
    crtRAF = requestAnimationFrame(draw);
    if (!crtVideo || crtVideo.readyState < 2) return;
    const s = crtSize(cv, gameCanvas); if (!s) return;
    crtBind(crtGL.sample);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, crtGL.tex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, crtVideo); } catch (_) { return; }
    gl.viewport(0, 0, s.w, s.h);
    gl.uniform1i(u.tex, 0);
    gl.uniform2f(u.game, GAME_W, GAME_H);
    gl.uniform1f(u.scan, def.scan);
    gl.uniform1f(u.mask, def.mask);
    gl.uniform1f(u.vig, def.vig);
    gl.uniform1f(u.curve, def.curve);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  draw();
}

// Keep the overlay aligned as the canvas mounts (async) / resizes / fullscreens.
function startCrtSync() {
  if (crtStop) return;
  const dos = $("dos");
  const ro = (typeof ResizeObserver !== "undefined") ? new ResizeObserver(renderCrt) : null;
  if (ro && dos) ro.observe(dos);
  const onResize = () => renderCrt();
  window.addEventListener("resize", onResize);
  document.addEventListener("fullscreenchange", onResize);
  let tries = 0;
  const poll = setInterval(() => {
    const c = document.querySelector("#dos canvas");
    if (c) { if (ro) ro.observe(c); renderCrt(); }
    if (c || ++tries > 25) clearInterval(poll);
  }, 200);
  crtStop = () => {
    if (ro) ro.disconnect();
    window.removeEventListener("resize", onResize);
    document.removeEventListener("fullscreenchange", onResize);
    clearInterval(poll);
  };
}

// ---- launching -------------------------------------------------------------

async function launch(url, key) {
  $("launcher").hidden = true;
  $("topbar").hidden = true;
  $("footer").hidden = true;
  $("game-stage").hidden = false;
  currentKey = key;

  const engine = getSetting("engine") === "dosboxX" ? "dosboxX" : "dosbox";
  $("game-stage").classList.toggle("xstate", engine === "dosboxX");

  const touch = touchEnabled();
  if (touch) {
    $("game-stage").classList.add("touch");
    $("touch-controls").hidden = false;
    renderTouchActions(key);   // jump/fire buttons for this game
    const AR = { "4/3": "4 / 3", "5/4": "5 / 4", "16/10": "16 / 10", "16/9": "16 / 9",
                 "1/1": "1 / 1", "AsIs": "16 / 10", "Fit": "16 / 10" };
    $("dos").style.aspectRatio = AR[getSetting("aspect")] || "4 / 3";
  }

  let bootUrl = url;
  const saved = await saveGet(key);
  if (saved) { savedBlobUrl = URL.createObjectURL(saved); bootUrl = savedBlobUrl; }

  dosCi = Dos($("dos"), {
    url: bootUrl,
    key,
    autoStart: true,
    autoSave: false,
    backend: engine,
    noCloud: true,
    thinSidebar: touch,
    renderAspect: getSetting("aspect"),
    imageRendering: getSetting("rendering"),
    onEvent: (event, arg) => {
      if (event === "ci-ready") {
        gameCi = arg;
        try { if (/[?&#]debug/.test(location.href)) window.__dukeCi = arg; } catch (_) {}
      }
      if (event === "error") {
        alert("js-dos error:\n\n" + arg +
          "\n\nIf you supplied your own files, double-check you selected the whole game " +
          "folder — the .EXE plus all its data files (Duke Nukem 1: *.DN1/2/3; Duke Nukem II: NUKEM2.*).");
      }
    },
  });

  // Apply the chosen visual filter and keep its overlay glued to the canvas.
  startCrtSync();
  renderCrt();

  clearInterval(saveTimer);
  saveTimer = setInterval(() => captureSave(key), 30000);

  if (location.hash !== "#" + key) history.pushState({ playing: key }, "", "#" + key);
}

window.addEventListener("popstate", async () => {
  if (!dosCi) return;
  clearInterval(saveTimer);
  await captureSave(currentKey);
  location.reload();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && dosCi) captureSave(currentKey);
});

function deepLink() {
  const key = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  history.replaceState(null, "", location.pathname + location.search);
  if (key && launchable[key]) launch(launchable[key], key);
}

// ---- user-supplied data -> .jsdos bundle -----------------------------------

async function handleFiles(fileList) {
  const status = $("file-status");
  const playList = $("byo-play-list");
  status.hidden = false;
  playList.innerHTML = "";
  pendingFiles = null;

  const files = [];
  for (const f of fileList) {
    const name = f.name.toUpperCase();
    files.push({ name, data: new Uint8Array(await f.arrayBuffer()) });
  }

  const names = files.map((f) => f.name);
  const found = detectGames(names);

  if (!found.length) {
    status.innerHTML = `<div class="miss">✗ Couldn't recognise these as Duke Nukem files. ` +
      `Select the whole game folder — Duke Nukem 1: <code>DN1.EXE</code> + <code>*.DN1</code> ` +
      `(and <code>DN2/DN3.EXE</code> + <code>*.DN2/3</code> for episodes 2&amp;3); ` +
      `Duke Nukem II: <code>NUKEM2.EXE</code> + <code>NUKEM2.CMP</code>.</div>`;
    return;
  }

  pendingFiles = files;
  const titles = found.map((k) => `<div class="ok">✓ ${GAMES[k].title}</div>`).join("");
  status.innerHTML = `<div><strong>Selected ${files.length} file(s) — detected ` +
    `${found.length} game${found.length > 1 ? "s" : ""}:</strong></div>` + titles +
    (found.length > 1 ? `<div style="margin-top:.4rem">Pick one to play:</div>` : "");

  // One Play button per detected game (covers a full Duke Nukem 1 folder = 3 episodes).
  found.forEach((k) => {
    const btn = document.createElement("button");
    btn.className = "play-btn";
    btn.textContent = `▶ Play ${GAMES[k].short}`;
    btn.addEventListener("click", () => playByoGame(k));
    playList.appendChild(btn);
  });
}

function buildBundleBlob(files, runCmd) {
  const conf = DOSBOX_CONF.replace("__RUNCMD__", runCmd);
  const tree = {
    ".jsdos/dosbox.conf": fflate.strToU8(conf),
    "dosbox.conf": fflate.strToU8("[cpu]\ncycles=auto\n"),
  };
  // Bundle EVERY supplied file — Duke games need their full data set, and Duke
  // Nukem 1's episodes share one folder.
  for (const f of files) tree[f.name] = f.data;
  const zipped = fflate.zipSync(tree, { level: 6 });
  return new Blob([zipped], { type: "application/octet-stream" });
}

function playByoGame(key) {
  if (!pendingFiles || !GAMES[key]) return;
  const blob = buildBundleBlob(pendingFiles, GAMES[key].run);
  launch(URL.createObjectURL(blob), key);
}

// ---- touch controls --------------------------------------------------------

const activeByPointer = new Map(); // pointerId -> [keyCodes]

function sendKey(code, down) {
  if (gameCi && typeof gameCi.sendKeyEvent === "function") {
    try { gameCi.sendKeyEvent(code, down); } catch (_) {}
  }
}

function bindTouchButton(btn) {
  const keys = (btn.dataset.keys || "").split(",").map(Number).filter(Boolean);
  if (!keys.length) return;
  const stagger = parseInt(btn.dataset.stagger || "0", 10) || 0;
  let timers = [];

  const press = (e) => {
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    btn.classList.add("active");
    if (e.pointerId != null) activeByPointer.set(e.pointerId, keys);
    timers.forEach(clearTimeout); timers = [];
    keys.forEach((k, i) => {
      if (stagger && i > 0) timers.push(setTimeout(() => sendKey(k, true), stagger * i));
      else sendKey(k, true);
    });
  };
  const release = (e) => {
    timers.forEach(clearTimeout); timers = [];
    btn.classList.remove("active");
    keys.forEach((k) => sendKey(k, false));
    if (e && e.pointerId != null) activeByPointer.delete(e.pointerId);
  };

  btn.addEventListener("pointerdown", press);
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointercancel", release);
  btn.addEventListener("lostpointercapture", release);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  btn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
}

// All Duke Nukem games use the same scheme: arrows move, Ctrl = jump, Alt = fire.
// GLFW codes: Left-Ctrl=341, Left-Alt=342.
const TOUCH_ACTIONS = {
  _default: [{ label: "FIRE", keys: "342", cls: "fire" },
             { label: "JUMP", keys: "341", cls: "jump" }],
};
function renderTouchActions(key) {
  const wrap = document.querySelector("#touch-controls .actions");
  if (!wrap) return;
  const cfg = TOUCH_ACTIONS[key] || TOUCH_ACTIONS._default;
  wrap.innerHTML = "";
  cfg.forEach((b) => {
    const el = document.createElement("button");
    el.className = "abtn " + b.cls;
    el.dataset.keys = b.keys;
    el.textContent = b.label;
    wrap.appendChild(el);
    bindTouchButton(el);
  });
}

// Virtual joystick -> arrow keys (8-way). Removes the dead center of a d-pad.
const ARROWS = { up: 265, down: 264, left: 263, right: 262 };
const arrowState = { up: false, down: false, left: false, right: false };

function setArrow(dir, on) {
  if (arrowState[dir] !== on) {
    arrowState[dir] = on;
    sendKey(ARROWS[dir], on);
  }
}
function clearArrows() { Object.keys(ARROWS).forEach((d) => setArrow(d, false)); }

function setupJoystick() {
  const base = $("stick");
  const knob = $("stick-knob");
  if (!base) return;
  let pid = null;

  const update = (cx, cy) => {
    const r = base.getBoundingClientRect();
    const ox = r.left + r.width / 2;
    const oy = r.top + r.height / 2;
    const dx = cx - ox;
    const dy = cy - oy;
    const max = r.width / 2;
    const dist = Math.hypot(dx, dy);
    const k = Math.min(1, dist / max);
    const ang = Math.atan2(dy, dx);
    knob.style.transform = `translate(${Math.cos(ang) * k * max}px, ${Math.sin(ang) * k * max}px)`;

    const want = { up: false, down: false, left: false, right: false };
    if (dist >= max * 0.3) {
      let a = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;
      if (a >= 22.5 && a < 67.5) { want.up = want.right = true; }
      else if (a >= 67.5 && a < 112.5) { want.up = true; }
      else if (a >= 112.5 && a < 157.5) { want.up = want.left = true; }
      else if (a >= 157.5 && a < 202.5) { want.left = true; }
      else if (a >= 202.5 && a < 247.5) { want.down = want.left = true; }
      else if (a >= 247.5 && a < 292.5) { want.down = true; }
      else if (a >= 292.5 && a < 337.5) { want.down = want.right = true; }
      else { want.right = true; }
    }
    Object.keys(ARROWS).forEach((d) => setArrow(d, want[d]));
  };
  const reset = () => { pid = null; knob.style.transform = ""; clearArrows(); };

  base.addEventListener("pointerdown", (e) => {
    e.preventDefault(); pid = e.pointerId;
    try { base.setPointerCapture(pid); } catch (_) {}
    update(e.clientX, e.clientY);
  });
  base.addEventListener("pointermove", (e) => { if (e.pointerId === pid) update(e.clientX, e.clientY); });
  base.addEventListener("pointerup", (e) => { if (e.pointerId === pid) reset(); });
  base.addEventListener("pointercancel", (e) => { if (e.pointerId === pid) reset(); });
}

function setupKeyboard() {
  const btn = $("kbd-btn");
  const proxy = $("kbd-proxy");
  if (!btn || !proxy) return;

  const SHIFT = 340;
  const SPECIAL = {
    Enter: 257, Backspace: 259, Tab: 258, Escape: 256,
    ArrowUp: 265, ArrowDown: 264, ArrowLeft: 263, ArrowRight: 262,
  };
  const PUNCT = { "-":45,"=":61,"[":91,"]":93,";":59,"'":39,",":44,".":46,"/":47,"\\":92,"`":96 };

  const hold = (code, shift) => {
    if (shift) sendKey(SHIFT, true);
    sendKey(code, true);
    setTimeout(() => { sendKey(code, false); if (shift) sendKey(SHIFT, false); }, 50);
  };
  const typeChar = (ch) => {
    if (ch === " ") return hold(32);
    if (ch === "\n") return hold(257);
    const u = ch.toUpperCase().charCodeAt(0);
    if ((u >= 65 && u <= 90) || (u >= 48 && u <= 57)) return hold(u, ch >= "A" && ch <= "Z");
    if (PUNCT[ch] != null) return hold(PUNCT[ch]);
  };

  const toggle = (e) => {
    e.preventDefault();
    if (document.activeElement === proxy) { proxy.blur(); btn.classList.remove("active"); }
    else { proxy.value = ""; proxy.focus(); btn.classList.add("active"); }
  };
  btn.addEventListener("pointerup", toggle);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  proxy.addEventListener("blur", () => btn.classList.remove("active"));

  proxy.addEventListener("beforeinput", (e) => {
    if (e.inputType === "insertText" && e.data) { for (const ch of e.data) typeChar(ch); }
    e.preventDefault();
    proxy.value = "";
  });
  proxy.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (SPECIAL[e.key] != null) { hold(SPECIAL[e.key]); e.preventDefault(); }
  });
  proxy.addEventListener("keyup", (e) => { e.stopPropagation(); });
  proxy.addEventListener("keypress", (e) => { e.stopPropagation(); });
}

function backendTrigger(event) {
  if (gameCi && typeof gameCi.sendBackendEvent === "function") {
    try { gameCi.sendBackendEvent({ type: "wc-trigger-event", event }); } catch (_) {}
  }
}
function setupSaveLoad() {
  const trigger = $("saveload-btn");
  const popup = $("saveload-popup");
  const save = $("savestate-btn");
  const load = $("loadstate-btn");
  if (!trigger || !popup) return;

  const isOpen = () => popup.classList.contains("open");
  const open = () => { popup.hidden = false; popup.classList.add("open"); };
  const close = () => { popup.classList.remove("open"); popup.hidden = true; };

  trigger.addEventListener("pointerup", (e) => { e.preventDefault(); isOpen() ? close() : open(); });
  trigger.addEventListener("contextmenu", (e) => e.preventDefault());
  trigger.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });

  const act = (btn, fn) => {
    if (!btn) return;
    btn.addEventListener("pointerup", (e) => {
      e.preventDefault(); btn.classList.add("active"); fn();
      setTimeout(() => btn.classList.remove("active"), 200); close();
    });
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
    btn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  };
  act(save, () => { backendTrigger("hand_savestate"); setTimeout(() => captureSave(currentKey), 700); });
  act(load, () => backendTrigger("hand_loadstate"));

  document.addEventListener("pointerdown", (e) => {
    if (isOpen() && !popup.contains(e.target) && !trigger.contains(e.target)) close();
  }, true);
}

function setupTouchControls() {
  document.querySelectorAll("#touch-controls [data-keys]").forEach(bindTouchButton);
  setupJoystick();
  setupKeyboard();
  setupSaveLoad();

  const pad = $("touch-controls");
  if (pad) {
    pad.addEventListener("contextmenu", (e) => e.preventDefault());
    pad.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    pad.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  }
  const releaseAll = () => {
    activeByPointer.forEach((keys) => keys.forEach((k) => sendKey(k, false)));
    activeByPointer.clear();
    clearArrows();
    document.querySelectorAll("#touch-controls .active").forEach((b) => b.classList.remove("active"));
  };
  window.addEventListener("blur", releaseAll);
}

// ---- launcher: saved-game download / upload / delete -----------------------

async function refreshSavesUI() {
  const list = $("saves-list");
  if (!list) return;
  const keys = (await saveListKeys()).filter((k) => GAMES[k]).sort();
  if (!keys.length) {
    list.innerHTML = `<p class="save-info">No saved games yet — your progress is stored here automatically once you play.</p>`;
    return;
  }
  const rows = await Promise.all(keys.map(async (k) => {
    const b = await saveGet(k);
    const kb = b ? Math.round(b.size / 1024) : 0;
    return `<div class="save-row"><span>${GAMES[k].short} <small>(${kb}&nbsp;KB)</small></span>` +
      `<span class="save-row-btns">` +
      `<button class="save-btn" data-dl="${k}">⤓ Download</button>` +
      `<button class="save-btn danger" data-del="${k}" aria-label="Delete">🗑</button></span></div>`;
  }));
  list.innerHTML = rows.join("");
  list.querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", () => downloadSave(b.getAttribute("data-dl"))));
  list.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => deleteSaveUI(b.getAttribute("data-del"))));
}

async function downloadSave(key) {
  const blob = await saveGet(key);
  if (!blob) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = key + "-save.jsdos";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function deleteSaveUI(key) {
  if (!confirm(`Delete the saved game for ${GAMES[key].short} in this browser? This cannot be undone.`)) return;
  await saveDelete(key);
  await refreshSavesUI();
}

// Import a downloaded save. Detect the game from the filename, else by sniffing
// the data files inside the .jsdos (zip) bundle.
async function importSave(file) {
  if (!file) return;
  const buf = new Uint8Array(await file.arrayBuffer());
  let key = (file.name.match(/^(duke1ep2|duke1ep3|duke1|duke2)/i) || [])[1];
  key = key ? key.toLowerCase() : null;
  if (!key || !GAMES[key]) {
    try {
      const inside = Object.keys(fflate.unzipSync(buf)).map((n) => n.toUpperCase().split("/").pop());
      key = detectGames(inside)[0] || null;
    } catch (_) {}
  }
  if (!key || !GAMES[key]) {
    alert("Couldn't tell which game this save is for — expected a Duke Nukem 1/2 save.");
    return;
  }
  await savePut(key, new Blob([buf], { type: "application/octet-stream" }));
  await refreshSavesUI();
  alert("Save imported for " + GAMES[key].short + ". It loads next time you play that game.");
}

// ---- settings UI -----------------------------------------------------------

function setupSettings() {
  [["set-aspect", "aspect"], ["set-rendering", "rendering"], ["set-touch", "touch"], ["set-engine", "engine"], ["set-filter", "filter"]]
    .forEach(([id, key]) => {
      const sel = $(id);
      if (!sel) return;
      sel.value = getSetting(key);
      sel.addEventListener("change", () => {
        setSetting(key, sel.value);
        if (key === "rendering" || key === "filter") renderCrt();   // apply live to a running game
      });
    });
}

// ---- server / kiosk mode ---------------------------------------------------

async function setupServerMode() {
  let manifest;
  try {
    const res = await fetch("games/manifest.json", { cache: "no-store" });
    if (!res.ok) return;
    manifest = await res.json();
  } catch (_) { return; }
  if (!manifest || !manifest.serverMode || !Array.isArray(manifest.games) || !manifest.games.length) return;

  $("demo-card").hidden = true;
  $("byo-card").hidden = true;

  const list = $("server-games-list");
  list.innerHTML = "";
  manifest.games
    .slice()
    .sort((a, b) => String(a.key).localeCompare(String(b.key)))
    .forEach((g) => {
      const btn = document.createElement("button");
      btn.className = "play-btn";
      const title = g.title || (GAMES[g.key] && GAMES[g.key].title) || g.key;
      btn.textContent = `▶ Play ${title}`;
      launchable[g.key] = g.bundle;
      btn.addEventListener("click", () => launch(g.bundle, g.key));
      list.appendChild(btn);
    });
  $("server-games").hidden = false;
}

// ---- wiring ----------------------------------------------------------------

window.addEventListener("DOMContentLoaded", () => {
  setupSettings();
  setupTouchControls();
  launchable["duke1"] = "games/duke1.jsdos";   // bundled shareware (overridden by server manifest if present)
  launchable["duke2"] = "games/duke2.jsdos";
  setupServerMode().then(deepLink);

  refreshSavesUI();
  $("save-upload").addEventListener("click", () => $("save-file-input").click());
  $("save-file-input").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = ""; importSave(f);
  });

  $("play-duke1").addEventListener("click", () => launch("games/duke1.jsdos", "duke1"));
  $("play-duke2").addEventListener("click", () => launch("games/duke2.jsdos", "duke2"));

  const dz = $("dropzone");
  const input = $("file-input");
  dz.addEventListener("click", () => input.click());
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") input.click(); });
  input.addEventListener("change", () => { if (input.files.length) handleFiles(input.files); });

  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); })
  );
  dz.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) handleFiles(dt.files);
  });
});

})();
