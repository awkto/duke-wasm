# Game data

## Included — Apogee shareware (freely redistributable)

### `duke1.jsdos` — Duke Nukem (1991), Episode 1: "Shrapnel City"
The original shareware episode, runs `DN1.EXE`. Source: the Apogee shareware release
(`duke1.zip`, Internet Archive item `duke-nukum1-sw`), whose `LICENSE.DOC` is Apogee's shareware
distribution agreement.

### `duke2.jsdos` — Duke Nukem II (1993), shareware episode
The shareware episode, runs `NUKEM2.EXE` (`NUKEM2.CMP` holds episode 1's data). Its `VENDOR.DOC`
states: *"Everyone can — and is encouraged! — to copy, upload and distribute"* the shareware.

## NOT included — registered/full data (commercial)

The registered Duke Nukem episodes 2 & 3 and the registered Duke Nukem II are commercial.
**Their data files must never be committed to this repository.**

- On the **public site**, players supply their own copies at runtime via the file picker; those
  files are assembled into a `.jsdos` bundle in the browser and never uploaded anywhere.
- On a **self-hosted server** (see the repo README), mount the full game files at `/data` — the
  container detects them, builds the bundles at startup, and serves the full games directly.

Detection signatures (used by both the browser picker and the server entrypoint):

| Game | Run | Signature data |
|------|-----|----------------|
| Duke Nukem — Ep. 1 | `DN1.EXE`    | `*.DN1` |
| Duke Nukem — Ep. 2 | `DN2.EXE`    | `*.DN2` |
| Duke Nukem — Ep. 3 | `DN3.EXE`    | `*.DN3` |
| Duke Nukem II      | `NUKEM2.EXE` | `NUKEM2.CMP` |

A full Duke Nukem 1 folder (all three `DN?.EXE` + `*.DN1/2/3`) yields all three episodes.
