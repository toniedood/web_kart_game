# Peaky Console – TV & Ping Notes (summary for a new conversation)
Date: 2026-11-09 · Author: Toni (with Claude) · Full project context and status log: `CLAUDE.md`

## The project in one paragraph
Peaky Console is a party game console in the browser. A shared screen (now a MacBook over HDMI to a TV) runs the game. 2–4 players use their **phones as controllers** by scanning a QR code; nothing to install. Three games: **Kart Race** (3D, Three.js, split screen), **Neon Brawl** (2D fighter), **Hell Keep** (Doom-style raycaster shooter). Server: Python FastAPI + python-socketio on **Render (free plan, currently Oregon, US)**. The server only relays messages; the host page runs all game logic. Build: Vite 8.3.6, three r187. Repo: GitHub `toniedood/web_kart_game`.
Working mode: Toni learns (Python background, new to JS); the AI guides and the VS Code agent implements task lists from `CLAUDE.md`. Metric units.

## Ping – what we know
- Path: phone → server → host. Measured with the `P` overlay on the host:
  - **SERVER 250–300 ms** (Oregon is far from Bulgaria).
  - **DIRECT 20–90 ms** over the WebRTC data channel (phone ↔ host on the same Wi-Fi). Expected ~5–15 ms.
- Already done: WebRTC direct channel with Socket.IO fallback (72e991c), compression off, websocket-only Socket.IO, host pings phones 20×/s to keep the phones' Wi-Fi awake (22702d0) – this did **not** lower DIRECT.
- Next (task list **9.1b** in `CLAUDE.md`, for the VS Code agent):
  - **A.** Overlay diagnostics via `pc.getStats()`: network-only RTT, worst spike, route type (`host`/`srflx`). This separates network delay from "host page busy rendering".
  - **B.** Unreliable, unordered channel (`ordered:false, maxRetransmits:0`) sending the **full button state** + sequence number every change and every 50 ms → no waiting for lost packets, no stuck buttons.
  - **C.** New Render service with `region: frankfurt` (a region can't be changed on an existing service) → SERVER ~40–60 ms.
  - **D.** Only if A shows the host page is slow: lighter kart rendering (shadows, rows, particles).
- Toni's checks without code: MacBook on Ethernet or `sudo ifconfig awdl0 down` (macOS AirDrop/Handoff channel hopping causes 20–100 ms Wi-Fi spikes), phones on 5 GHz, Low Power Mode off, TV **Game Mode** on (saves 50–100 ms of picture processing).
- Realistic target: DIRECT peaks < 30 ms, SERVER < 60 ms.

## TVs – decision: no APK, a TV-friendly web app
Not all TVs run Android TV, so the plan is one web app that runs in the TV's own browser. (Godot was considered: faster on weak hardware but means rewriting all three games and does not improve ping → only plan B if the TV is far too slow.)

### TV browsers (engine the TV ships with – it never updates)
| TV | Browser engine by model year | Notes |
|---|---|---|
| LG webOS | 2021: Chromium 79 · 2022: 87 · 2023: 94 · 2024: 108 · 2025: 120 · 2026: 132 | Magic Remote acts as a mouse pointer |
| Samsung Tizen | 2021: M76 · 2022: M85 · 2023: M94 · 2024: M108 · 2025: M120 · 2026: M130 | Browser may use arrows to move a cursor |
| Android / Google TV | no browser by default | install one, or use another device |
| Fire TV | Silk (Chromium) | works |
| Roku | no browser | not possible |

### TV hardware
TV chips are made for video, not games: CPU/GPU usually weaker than a mid-range phone, browser often renders at 1080p even on 4K TVs. The 2D games should be fine; **Kart Race with 3–4 views** is the risk. Our pixel look (360 rows scaled up) already helps.

### "9.2 TV browser mode" – proposed steps (not yet in `CLAUDE.md`)
1. **Old browsers:** Vite 8 builds for Chrome 111+ by default → pre-2024 TVs may show a blank page. Fix: `build: { target: "chrome85" }` in `vite.config.js` (check runtime APIs too).
2. **Phone 1 = captain:** the first phone controls the lobby menus (D-pad moves GAME/TRACK/BOTS/START, A selects). The TV just opens a link; the remote is optional (arrows/Enter as a bonus).
3. **Short URL / bookmark** – typing on a TV remote is painful.
4. **"PRESS OK" start screen** – TV browsers need a key press on the TV to allow sound.
5. **Auto quality preset:** if lobby FPS < ~45 → 270 rows or fewer, shadows off, fewer particles/trees; `?tv` forces it.
6. **Keep screen on:** `navigator.wakeLock.request("screen")` (Chromium 84+, HTTPS).
7. **Safe edges:** HUD ~5 % from the edges (overscan).
8. **Connection:** if the TV browser lacks WebRTC, the existing Socket.IO fallback is used → another reason for Frankfurt.

### If the TV browser is not good enough (still no APK)
- Laptop over HDMI (current, best quality).
- Fire TV Stick with Silk.
- Mini PC / Raspberry Pi 5 with Chrome in kiosk (full screen) mode – same on every TV.
- Avoid Chromecast tab casting / AirPlay mirroring: they stream video and add 100–300 ms.

## Open questions
- Which TV (brand + year) will be tested first?
- Add "9.2 TV browser mode" to `CLAUDE.md` as a task list (replacing the Capacitor/APK plan)?
- Results of task A diagnostics and Toni's network checks.

## Sources
- LG webOS web engine: https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine
- Samsung TV web engine: https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html
- webOSBrew web engine: https://www.webosbrew.org/develop/guides/web-app/web-engine
- Vite build options: https://vite.dev/config/build-options
