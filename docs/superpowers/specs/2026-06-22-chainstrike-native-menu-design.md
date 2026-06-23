# ChainStrike Native Menu — Design Spec

**Date:** 2026-06-22
**Status:** Approved, implementing
**Author:** Claude Code (cc:webxash3d-fwgs) + r4vager

## Goal

Replace the entire stock CS/Xash mainui (launch menu **and** ESC pause menu) with a
gutted, ChainStrike-branded **native** menu compiled into
`menu_emscripten_wasm32.wasm`. Remove the DOM `#escMenu` / `#connecting` overlay so the
native menu is the *sole* menu. This is a real game-file modification, not a DOM mask.

## Background / Current State

- The in-game menu is the engine's native **mainui**, shipped as
  `cstrike/cl_dlls/menu_emscripten_wasm32.wasm` inside the `cs16-client` npm package.
- Until now, "menu removal" was a **DOM overlay** (`#escMenu` in `index.html` + handlers
  in `main.ts`) layered over the canvas, plus auto-connect to skip the launch menu. The
  native menu still runs underneath and its escape-hatch buttons (Change Game,
  Multiplayer, Console) remain reachable.
- Menu source is available: `packages/cs16-client/cs16-client/3rdparty/mainui_cpp`
  (nested git submodule, now initialized at `e6d8da7`).

## What We Modify

Primarily one file: `3rdparty/mainui_cpp/menus/Main.cpp` — the `CMenuMain` class.
`CMenuMain` is **both** menus in one: `VidInit(bool connected)` swaps the visible button
set based on connection state (launch vs in-game).

### The gut

**In-game (ESC, connected):** keep only
- **RESUME** (`resumeGame`)
- **OPTIONS** (→ retained native audio/controls/config screen)
- **QUIT TO LOBBY**

Remove: Disconnect-confirm dialog clutter, Console, Save/Restore, and anything else.

**Launch (not connected):** the client auto-connects, so this is barely seen. Show a
branded **CHAINSTRIKE** banner + "CONNECTING…" only. Remove New Game, Multiplayer,
Create Game, **Change Game**, Custom Game, Console, Previews, Readme — every escape hatch
into the raw engine.

**Branding:** ChainStrike background + title/banner via existing native PIC draw. Keep
native button rendering (no custom font/bmp). Full lime/magenta + Oxanium reskin is a
**deferred** follow-up, not in this scope (decision: "Functional gut + branding").

## The One JS Touchpoint

"Quit to Lobby" needs a browser redirect, which the wasm sandbox cannot do itself. The
native button triggers the engine `quit`/exit path; a minimal hook in `main.ts` catches
it and does `window.location.href = "https://54.39.97.84.sslip.io"`. Everything else (the
menu UI) is native. The rest of the DOM overlay (`#escMenu`, `#connecting` masking,
custom ESC handlers) is deleted.

Fallback if the exit hook isn't cleanly exposed by the yohimik wrapper: bind Quit to
`disconnect` and watch connection state in JS to trigger the redirect.

## Build → Deploy Pipeline

1. Edit `Main.cpp` (+ submodule already initialized).
2. Rebuild the menu wasm via the emscripten container
   (`emscripten/emsdk:4.0.17`, `emcmake cmake -S . -B build … --target install`, per
   `packages/cs16-client/Dockerfile`) → extract new `menu_emscripten_wasm32.wasm`.
3. Drop the new wasm on the box; add a bind-mount over
   `/xashds/public/cstrike/cl_dlls/menu_emscripten_wasm32.wasm` in the compose file (same
   pattern already used for `index.html`/`assets`). The menu wasm is **baked into the
   image** today (not mounted), so the mount override avoids a full image rebuild.
4. Restart the 5 match containers (`cs-web-server-match1..5`).
5. Verify in a **real browser**: launch shows no stock menu; ESC shows the ChainStrike
   menu; Resume / Options / Quit-to-Lobby all work.

## Deploy Target

- Box: `ubuntu@54.39.97.84` (`vps-2b3d4a4f`).
- 5 match containers, ports `:27016/27116/27216/27316/27416`.
- Repo on box: `/home/ubuntu/webxash3d-fwgs`.

## Risks / Wrinkles

1. **Quit→JS redirect**: exact mechanism (engine exit callback vs custom command) confirmed
   at build time; `disconnect`+state-watch fallback documented above.
2. **First emscripten build** may need a few iterations to compile clean.
3. **mainui button-set assumptions**: removing items must not break `VidInit` layout math
   or leave dangling `AddItem`/event-callback references. Compile catches most; in-browser
   verify catches the rest.

## Out of Scope

- Full ChainStrike visual reskin (custom fonts, lime/magenta button graphics) — deferred.
- In-game VGUI menus (team select / buy menu) — those live in `client.dll`, not menu.wasm.
- Vault funding / Privy origin / payout activation — separate open loops.

## Success Criteria

- Stock mainui never appears (no Change Game / Multiplayer / Console reachable).
- ESC in a live match shows the ChainStrike native menu with Resume / Options / Quit.
- Quit to Lobby redirects the browser to the landing page.
- DOM `#escMenu` / `#connecting` overlay removed; native menu is the only menu.
- All 5 match servers serve the new wasm and remain playable.
