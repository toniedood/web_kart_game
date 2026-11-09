# Kart Game – Project Context

Read this first. It carries the planning done so far, so we can continue here in VS Code.

## About me & how we work
- I'm Toni. I'm a physics/IT teacher, and I know Python (Telerik Academy) but I'm new to JavaScript.
- This is a learning exercise. **Mode: the AI guides, I write the code.** Give me plans, explanations, hints and code reviews. Don't write whole files for me unless I ask. Short snippets to explain a concept are fine.
- Explain JavaScript concepts by comparing them with Python when that helps.
- Use metric units.
- The plan will evolve over time. Update the "Status" section below when a step is finished or a decision changes.

## The game
A 3D kart racing game (Mario Kart-like, camera behind the kart). It is played on a shared screen (a laptop connected to a TV) in the browser. **Players use their phones as controllers.** They open a link or scan a QR code, with no app to install. The server runs in the cloud.

## Roadmap
0. Game concept & scope ✅
1. Architecture & tech stack ✅
2. Connection prototype: room code + QR code, a phone button press shows up on the TV ✅
3. Phone controller UI ✅
4. Core racing game: 3D scene, physics, track, laps, race flow ✅
5. Graphics & sound ✅
6. Extras: items, drifting, more tracks, AI karts ✅
7. Cloud deployment (Render) ✅ (live on Render, tested by Toni)
8. Polish ← WE ARE HERE
   - 8a. Peaky Console pixel look ✅ (tested on phone)
   - 8b. Two more 2-4 player games ✅ Neon Brawl (2D fighter) + Hell Keep (Doom-style shooter); Hell Keep not yet tested on real phones
   - 8c. Phone character customisation ✅
   - 8d. Final testing and polish (see status log)
9. Android TV app + lowest ping ← NEXT (plan below, Toni executes)
   - 9.1 Quick wins: Frankfurt region, measure DIRECT/SERVER ping, TV Game Mode
   - 9.1b Ping fixes: task list A–D for the VS Code agent + Toni's network checks ← NEXT
   - 9.2 Android TV wrapper (Capacitor + WebView, remote-control lobby)
   - 9.3 Optional: Home mode (local server inside the TV app, works offline) — on hold (Toni's call)

## Step 0 – Concept decisions
- 3D with the camera behind the kart (Three.js)
- 2–4 players on one screen, **split screen**: 2 players = top/bottom halves, 3–4 players = quarters
- Phone controls are **buttons only**: Left, Right, Gas, Brake/Reverse. An Item button comes later.
- The phone is held in landscape: left thumb steers, right thumb handles gas and brake
- **Python server**. The browser code must be JavaScript (the host game and the phone controller).

**MVP (version 1 is done when):**
- The host opens the site and sees a room code and a QR code
- 2–4 phones join, enter a name and get a kart colour
- The host starts → 3-2-1 countdown → 3-lap race on 1 flat track → results → rematch
- Low-poly karts that bump into walls and into each other
- Each split-screen view shows that player's lap and position

**Not in v1:** items, drifting, hills or jumps, AI karts, more tracks, accounts, online play between different homes, sound.

**Risks:** drawing 4 views of a 3D scene is heavy, so keep the models low-poly and run the game on a laptop, not the TV's built-in browser. Lag from phone to screen must feel instant (we check this in step 2).

## Step 1 – Architecture
**Host-authoritative relay:**
- **Host browser (JavaScript):** runs the game loop and physics (fixed 60 Hz step) and draws the split screen (Three.js `setViewport`/`setScissor`).
- **Server (Python):** serves the pages, manages rooms and relays messages. **It has no game logic.**
- **Phone browser (JavaScript):** controller page that only sends button down/up events.

```
Phone ──input──▶ Server ──relay──▶ Host
Host ──feedback (vibrate, lap, phase)──▶ Server ──▶ Phone
```

We don't need HTTPS for local development because there's no tilt control.

### Stack
- Server: Python 3.12+, **FastAPI + python-socketio** (ASGI), run with **uvicorn**, inside a `.venv`
- Browser: `socket.io-client`, `three`, `qrcode` (npm packages; the QR code is drawn on the host page)
- Node.js + npm are used **only for Vite** (dev server and build). Node is not needed on the deployed server.
- Physics: our own simple arcade physics for v1 (flat track, round collisions), no physics engine
- git + GitHub

### URLs
- `/` → host screen
- `/play?room=ABCD` → phone controller (the QR code encodes this)

### Folder structure
```
Web game app/
  CLAUDE.md
  requirements.txt         # fastapi, uvicorn, python-socketio
  server/main.py           # FastAPI + Socket.IO, rooms
  server/events.py         # event names (mirrors client/shared/events.js)
  package.json             # browser dependencies + Vite
  vite.config.js
  client/
    index.html             # host page
    play.html              # controller page
    host/main.js
    controller/main.js
    shared/events.js       # event names + constants
```
- Dev: Vite (port 5173) proxies `/socket.io` to uvicorn (port 8000).
- Prod: FastAPI serves the `dist/` folder that Vite builds.

### Message protocol (v1)
| Event | Direction | Payload |
|---|---|---|
| `host:create` | host → server (ack) | → `{ code }` |
| `player:join` | phone → server (ack) | `{ code, name, playerId? }` → `{ ok, playerId, color }` or `{ ok:false, error }` |
| `player:joined` / `player:left` | server → host | `{ playerId, name, color }` / `{ playerId }` |
| `input` | phone → server → host | `{ playerId, btn: "left"\|"right"\|"gas"\|"brake"\|"item", down: bool }` |
| `game:phase` | host → server → phones | `{ phase: "lobby"\|"countdown"\|"race"\|"results" }` |
| `player:feedback` | host → server → one phone | `{ lap, position, item?, vibrate? }` (`item`: null\|"boost"\|"banana"\|"rocket") |
| `room:closed` | server → phones | `{}` |
| `rtc:signal` | phone ⇄ host via server | `{ data: { sdp } or { candidate } }` (host → phone adds `playerId`). Sets up the WebRTC connection |
| data channel `state` | phone → host, direct | **unreliable** (`ordered:false, maxRetransmits:0`): `{ s: bit mask of buttons (bit i = BUTTONS[i]), n: sequence }`, sent on every change, every 50 ms while held and for 100 ms after release. Each *change* is also sent on `peaky` with the same `n` |
| data channel `peaky` | both ways, direct | **reliable**: host → phone `player:feedback` objects and `{ping}`; phone → host `{pong}`, the reliable copy of state changes, and (when no `state` channel) `{btn, down}` |

**Rules:**
- Room codes are 4 letters
- A room holds at most 4 players
- The phone saves its `playerId` in localStorage so it can rejoin after a refresh
- If the host disconnects, the room closes

## Step 1 – My setup tasks (current)
1. [x] Install Python 3.12+ and Node LTS (`python3 --version`, `node -v`)
2. [x] `git init`; `python3 -m venv .venv`; `source .venv/bin/activate`; `pip install fastapi uvicorn python-socketio`; `pip freeze > requirements.txt`
3. [x] `npm init -y`; `npm i three socket.io-client qrcode`; `npm i -D vite`
4. [x] `.gitignore` with: `.venv`, `node_modules`, `dist`, `__pycache__`
5. [x] Create the folder structure (the files can be empty)
6. [x] Minimal FastAPI app that returns "Hello kart" on `/`, wrapped like this:
       `sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")`
       `app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)`
7. [x] Run `uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload`
8. [x] Open `http://<Mac LAN IP>:8000` on my phone (same Wi-Fi)
9. [ ] Learn: JavaScript basics compared with Python (let/const, arrow functions, import/export, events and callbacks); the python-socketio async server docs; the Socket.IO "Get started" tutorial (for the concepts)

**Step 1 is done when** my phone shows "Hello kart" served from my Mac.

## Step 9 – Android TV app + lowest ping (plan, Toni executes)
Goal: Peaky Console installs on an Android TV, is driven by the TV remote in the lobby, and a phone button reaches the game in < 15 ms at home.

### Where the delay comes from (approx., one button press)
| Part | Now | Target |
|---|---|---|
| Phone → TV path | Socket.IO via Oregon ≈ 150–200 ms; WebRTC direct (done, 72e991c) ≈ 3–10 ms on the same Wi-Fi | WebRTC direct on LAN |
| Set-up / fallback path | Oregon ≈ 150–200 ms | Frankfurt ≈ 30–40 ms |
| Waiting for the next 60 Hz tick | 0–17 ms | keep (fine) |
| TV picture processing | 50–100 ms without Game Mode | Game Mode on ≈ 10–20 ms |

Key idea: since the WebRTC channel exists, the cloud server is only needed to **introduce** phone and TV. After that, inputs never leave the home Wi-Fi. So step 9.3 (a local server inside the app) is only needed for offline / no-internet play.

### 9.1 Quick wins (do first, ~30 min)
1. [ ] In `render.yaml` add `region: frankfurt` under the service. Change `name:` to e.g. `peaky-console` (a region can't be changed on an existing service, so this creates a new one).
2. [ ] Push, then in Render: New → Blueprint → pick the repo. Wait for the deploy, open `/healthz`.
3. [ ] Test with 2 phones: press `P` on the host. Check `SERVER x MS` (expect ~30–40) and `DIRECT open/players rtt MS` (expect < 15 on the same Wi-Fi). Write both numbers in the status log.
4. [ ] Test one phone on **mobile data**: does DIRECT open, or does it fall back? (STUN only, no TURN — fallback is expected on some networks.)
5. [ ] When everything works on the new service, delete the old Oregon service.
6. [ ] Home setup: TV **Game Mode** on, TV/laptop on Ethernet if possible, phones on 5 GHz Wi-Fi.
- Learn: what STUN vs TURN do (STUN = "what is my public address?", TURN = a relay when no direct route exists). Optional later: free TURN (e.g. Metered/Cloudflare) added to `RTC_CONFIG` in `client/shared/events.js`.

**9.1 is done when** the overlay shows DIRECT open with < 15 ms on home Wi-Fi and SERVER < 50 ms.

### 9.1b Ping fixes – task list for the VS Code agent
Toni asked for these to be implemented by the AI (VS Code extension). Do them **in order**, one commit per task, and add a status-log line after each. Measured so far: SERVER 250–300 ms (Oregon), DIRECT 20–90 ms even with 20 pings/s (22702d0), so Wi-Fi power saving was not the main cause.

**Task A – Diagnostics in the `P` overlay (do first, it decides what matters)**
- [x] In `client/host/main.js`, every 1 s call `link.pc.getStats()` for each open link. Find the `candidate-pair` with `state === "succeeded"` (or `nominated`); read `currentRoundTripTime` (seconds → ms) and look up its `localCandidateId` / `remoteCandidateId` reports to get `candidateType` (`host` / `srflx` / `prflx` / `relay`). Store as `link.netRtt` and `link.route` (e.g. `host-host`).
- [x] Also record the worst DIRECT rtt in the last 5 s per link (`link.peak`), not only the smoothed value.
- [x] Overlay: one line per phone, e.g. `P1 DIRECT js 24 / net 6 / peak 88 MS host-host`, plus FPS and the time of the slowest frame in the last second (ms).
- [x] Nothing changes in gameplay. Verify headless that the numbers show.
- Reading the result: **net low but js high** → the host page is busy (rendering) → Task D. **net high** → Wi-Fi/network → Task B + Toni's checks below. **route not host-host** → the phones and the TV are not talking directly on the LAN (mDNS / router) → note it in the status log.

**Task B – Unreliable channel with full button state (removes the lost-packet spikes)**
- [x] Phone (`client/controller/main.js`): keep the current button state in one object `{ left, right, up, down, gas, brake, item }`. Open a second data channel `"state"` with `{ ordered: false, maxRetransmits: 0 }`. On every change, and again every 50 ms while any button is held (plus once 100 ms after the last release), send `{ s: <bitmask>, n: <sequence number> }`.
- [x] Host (`client/host/main.js`): on `"state"` messages ignore any with `n` lower than the last one seen; compare the bitmask with the current input and call `applyInput(playerId, btn, down)` only for buttons that changed. The game code itself does not change.
- [x] Keep the existing reliable `"peaky"` channel for pings, feedback and as a fallback; the Socket.IO path stays the last fallback (send full state there too, or keep btn/down events — must not leave a button stuck).
- [x] Update the message protocol table in this file.
- [x] Verify headless: a simulated phone presses/releases quickly, dropped messages (simulate by skipping sends) never leave a button stuck.

**Task C – Frankfurt server**
- [x] (render.yaml part) `render.yaml`: add `region: frankfurt` and rename the service to `peaky-console` (a region can't be changed on an existing service). Commit + push. Then **Toni**: Render → New → Blueprint → this repo; check `/healthz`; test; delete the old `kart-game` service in Oregon afterwards. Update the README/URL notes in this file with the new URL.

**Task D – Only if Task A shows the host page is the bottleneck (net low, js high)**
- [ ] Apply inputs the moment they arrive (already true: `applyInput` writes into `p.input`), but make sure nothing heavy runs in the message handler.
- [ ] Lower the per-frame cost when 3–4 players are in the kart race: shadow map size/updates (e.g. update the shadow every 2nd frame), `PIXEL_ROWS` back to 270 for 3–4 views, fewer particles. Target: slowest frame < 20 ms.
- [ ] Re-measure with the overlay and log FPS / slowest frame before and after.

**Toni's checks (no code, do while Task A is being built)**
1. [ ] Is the host the MacBook on Wi-Fi? Test with Ethernet, or run `sudo ifconfig awdl0 down` (turns off AirDrop/Handoff until restart or `sudo ifconfig awdl0 up`) and compare DIRECT.
2. [ ] Phones on **5 GHz** Wi-Fi; on a mesh, phones and Mac on the same node.
3. [ ] Low Power Mode / Battery Saver off on the phones.
4. [ ] TV Game Mode on.
5. [ ] Write the numbers (before/after each check) in the status log.

**Done when:** DIRECT peaks stay under ~30 ms on home Wi-Fi and SERVER < 60 ms.

### 9.2 Android TV wrapper with Capacitor (the real app)
Why Capacitor: it puts our existing `dist/` into an Android `WebView`, no rewrite. (Not a TWA: that needs Chrome, which most Android TVs don't have.)
1. [ ] Install **Android Studio** (includes the SDK + an Android TV emulator: Device Manager → TV → 1080p).
2. [ ] `npm i @capacitor/core` and `npm i -D @capacitor/cli @capacitor/android`
3. [ ] `npx cap init "Peaky Console" com.toni.peakyconsole --web-dir dist`
4. [ ] Decide where the page comes from (pick **A** first):
   - **A. Load from Render**: in `capacitor.config.json` set `"server": { "url": "https://<frankfurt-service>.onrender.com" }`. App = a TV shortcut to the website; updates go live with every push. Needs internet.
   - **B. Bundle `dist/` inside the app**: `npm run build && npx cap sync`. Then Socket.IO must point to the Render URL instead of "same origin" (`io("https://...")` in `host/main.js`), and the QR code must contain the full Render URL. Works faster at start-up, but every change needs a new APK.
5. [ ] `npx cap add android`, then `npx cap open android` (opens Android Studio).
6. [ ] Make it a TV app, in `android/app/src/main/AndroidManifest.xml`:
   - inside `<manifest>`: `<uses-feature android:name="android.software.leanback" android:required="false"/>` and `<uses-feature android:name="android.hardware.touchscreen" android:required="false"/>`
   - in the main `<activity>`'s `<intent-filter>`: add `<category android:name="android.intent.category.LEANBACK_LAUNCHER"/>`
   - on `<application>`: `android:banner="@drawable/banner"`; make a **320×180 px** PNG banner (Peaky Console logo) in `res/drawable/`
   - set the activity to landscape: `android:screenOrientation="landscape"`
7. [ ] Run it in the TV emulator (▶ in Android Studio). Check: the lobby shows, QR code is readable, a phone can join.
8. [ ] **Remote control in the lobby.** The remote sends normal key events to the page: `ArrowUp/Down/Left/Right`, `Enter` (OK), and Back = `Escape`/`GoBack` (check what arrives with a `console.log(e.key, e.keyCode)` in the `keydown` listener in `host/main.js`, ~line 584). Map them:
   - Up/Down = move between menu rows (GAME, TRACK, BOTS, START), Left/Right = change value, OK = start/rematch, Back = back to lobby (reuse `leaveGame()` with its confirm).
   - Show which row is selected (a highlight/blinking arrow), because there is no mouse.
   - Back on the lobby itself should **not** close the app by accident (Android: handle the back button; Capacitor `@capacitor/app` → `App.addListener('backButton', ...)`).
9. [ ] Keep the screen awake during play: `@capacitor-community/keep-awake` (or the Screen Wake Lock API: `navigator.wakeLock.request("screen")`).
10. [ ] **Performance test on real TV hardware** (e.g. Chromecast with Google TV / any Android TV box): kart race with 4 views, fight, shooter. Press `P` and write the FPS in the status log. If < 50 FPS: lower `PIXEL_ROWS` in `scene.js` (e.g. 270 → 200), fewer clouds/rocks, shadows off.
11. [ ] Install on the real TV: Android Studio → Build → Build APK, then either `adb connect <TV IP>` + `adb install app-debug.apk` (turn on Developer options + USB/network debugging on the TV), or a USB stick + a file manager app.
- Learn: what a WebView is (a browser without the address bar inside an app); the Android manifest (like a config file the system reads before starting the app); `adb` basics.

**9.2 is done when** the app shows on the TV home screen with the banner, the lobby is fully usable with the remote, and a 4-player race runs ≥ 50 FPS.

### 9.3 Optional: Home mode (offline, no cloud at all)
Only if we want it to work without internet (school Wi-Fi, café, travel). The TV app itself becomes the server:
1. [ ] Inside the Android app, start a small **HTTP + WebSocket server** in Kotlin (e.g. Ktor or NanoHTTPD) on port 8080. It serves `play.html` + `assets/` from the app and relays messages — the same rules as `server/main.py` (rooms, 4 players, relay, `rtc:signal`), ~180 lines of Python → Kotlin. Compare them side by side while writing.
2. [ ] Simplest protocol: plain WebSockets with JSON `{ "event": "...", "data": {...} }` instead of Socket.IO (no good Socket.IO server for Kotlin). That means a small adapter in the JS (`socket.emit/on` → our own tiny wrapper) so the same game code works with both servers.
3. [ ] The app finds the TV's Wi-Fi IP and the QR code encodes `http://<TV IP>:8080/play?room=ABCD`.
4. [ ] Lobby toggle: ONLINE (Render) / HOME (local server).
- Watch out: guest and school networks often block devices from seeing each other ("client isolation") → use a phone hotspot or a home router. HTTP (not HTTPS) is fine because we don't use tilt sensors.

**9.3 is done when** the TV and phones play with the internet unplugged from the router.

## Toni's to-do (next session)
Everything is pushed (last code commit `43eaa74`). Two things are waiting on Toni:

**1. Create the Frankfurt service on Render** (`render.yaml` already says `peaky-console`, `region: frankfurt`)
1. [ ] Render dashboard → New → Blueprint → pick the repo `toniedood/web_kart_game` → apply.
2. [ ] Wait for the deploy (the first Docker build on Render is also the first real test of the Dockerfile with `--ws-per-message-deflate false`; if the build fails, paste the log). Open `<new URL>/healthz`.
3. [ ] Open the new URL on the TV page, join with 2 phones, press **P**. `SERVER` should be about 30-40 ms.
4. [ ] When it works, delete the old `kart-game` service in Oregon.
5. [ ] Tell the AI the new URL (it goes into this file, and the old links/QR notes change).

**2. Send the overlay readings** (2 phones joined, wait ~10 s, then copy the lines)
- [ ] The first line: `FPS .. SLOWEST FRAME .. MS SERVER .. MS`
- [ ] One line per phone: `NAME DIRECT js x / net y / peak z MS route`
- [ ] Do it once in the lobby and once in a 4-player kart race (the FPS and slowest frame in the race show if the new graphics are too heavy).
- How the AI reads them (Task D in 9.1b): net low + js high = the host page is busy -> lighter rendering; net high = Wi-Fi (try Ethernet / 5 GHz / `sudo ifconfig awdl0 down`); route not `host-host` = phone and TV are not talking directly.

**Also still untested on real devices:** Hell Keep on phones, vibration patterns (Android only; iPhones get one tap at most), the floating joystick feel.

## Status log
- 2026-11-07: Steps 0 and 1 planned. Switched the server from Node to Python. Next: finish the setup tasks, then plan Step 2 in detail.
- 2026-11-07: Setup tasks 1–7 done (Node installed via brew, packages installed, `server/main.py` "Hello kart" works on localhost and the LAN IP). Toni asked the AI to write `server/main.py`, as this setup is not the coding exercise. Next: open the LAN URL on the phone (task 8).
- 2026-11-07: Task 8 done: the phone (192.168.0.241) loads "Hello kart" from the Mac. Step 1 setup is complete; only the learning task 9 remains. Next: plan Step 2 (connection prototype) in detail.
- 2026-11-07: Step 2 code written by the AI at Toni's request (server rooms + relay in `server/main.py`, `vite.config.js`, host page with room code + QR, phone controller with 4 buttons). Verified with a simulated host + phone (join, bad code, input relay, player:left). Not yet tested on a real phone. `/` on port 8000 moved to `/hello` because Vite now serves the host page. Run: `uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload` and `npm run dev`; open the host at `http://<Mac LAN IP>:5173` (not localhost, so the QR code works).
- 2026-11-07: Step 2 confirmed working on a real phone. Step 3 code written by the AI: landscape controller (steer left, gas/brake right), name entry, session saved in localStorage with auto-rejoin on refresh/reconnect (keeps playerId + colour), HUD with phase/lap/position, vibration feedback, "rotate your phone" overlay, pointer capture so thumbs can slide, buttons released on blur. Server: rejoining phone can ask for its old colour. Relay of game:phase/player:feedback verified with a simulated host. Needs a real-phone test.
- 2026-11-07: Step 3 confirmed on a real phone. Step 4 code written by the AI. Host modules in `client/host/`: `config.js` (STEP, LAPS, ...), `track.js` (closed Catmull-Rom centreline, 16 m wide, ~763 m; locate/gridPose), `physics.js` (arcade kart, wall + kart-kart collisions), `race.js` (countdown → race → results, laps, positions, 20 s finish timeout), `scene.js` (Three.js scene, split-screen viewports, chase cameras, lobby fly-over), `hud.js` (per-view name/lap/position/speed), `bots.js`, `main.js` (lobby, race flow, 60 Hz loop, phone feedback). Dev URL options: `/?bots=N&autostart&laps=1`. Keys: Enter/Space start/rematch, L = lobby. Verified headless (3 bots finish, wall/reverse/lap tests, screenshots of lobby, 2/3/4-view split screen, results, no console errors). Fixed a ground/road depth-fighting bug. Not yet tested with real phones driving. Physics numbers (MAX_SPEED 30 m/s, ACCEL, TURN_RATE, GRIP...) are at the top of `physics.js` for tuning by feel.
- 2026-11-07: Step 4 confirmed on real phones. Step 5 code written by the AI. Graphics (`scene.js`): detailed low-poly kart (wings, helmet, exhausts), steering + spinning wheels, body lean, blob shadows, name tags (hidden on your own kart and when closer than 14 m), sky gradient, clouds, rocks, start arch; minimap in `hud.js` (centre of the screen, bottom for 1 player; text in the 4-way junction corners is shifted away). Sound (`audio.js`): everything synthesised with Web Audio, no files: engine pitch follows speed, countdown/GO beeps, lap + finish jingles, bump thuds. `Race.events` (count/go/lap/finish/bump) is drained in `main.js` each tick. Audio starts on the first key/click; M mutes. Verified headless (events simulation, screenshots, AudioContext starts after a key press, no console errors). No music yet. `window.kartDebug` is exposed for console poking.
- 2026-11-07: Step 5 confirmed working. Step 6 code written by the AI (all four extras). **Tracks:** `tracks.js` holds 3 tracks with themes (Green Valley, Desert Run, Snow Ring); `track.js` now takes a definition; the scene rebuilds per track (`gfx.setTrack`); lobby picks the track (◀ ▶). **AI karts:** lobby picks 0–4 AI that fill free places (▲ ▼); `bots.js` steers, lifts for bends, uses items; `skill` 0.88–1.0 per bot. **Items:** `items.js`; 6 rows × 3 item boxes per lap (respawn 6 s), items boost / banana / rocket, better items for karts further back, hit = 1.3 s spin-out + 1.2 s immunity; phone has a new ITEM button and shows the held item; `?bots`, `?track=`, `?laps=`, `autostart` dev params. **Drifting:** hold BRAKE while steering above ~50 km/h; tighter turn + slide; release after 0.8 s (blue sparks) or 1.6 s (orange) for a small/big boost. New race events: pickup, use, hit, drift, driftboost (with sounds). Verified headless: all 3 tracks finishable by 4 AI, item pickup/banana/rocket/hit logic, drift + boost numbers, browser screenshots, no console errors. Not yet tested on real phones. Tuning knobs: top of `physics.js` and `items.js`; track shapes in `tracks.js`.
- 2026-11-07: Step 6 confirmed working. Step 7 prepared by the AI: `server/main.py` serves `dist/` when it exists (`/`, `/play`, `/assets`, plus `/healthz`); `Dockerfile` (node stage builds the game, python stage runs uvicorn on `$PORT`, 1 worker because rooms are in memory); `.dockerignore`; `render.yaml` (Blueprint, free plan, Docker). Verified without Docker (daemon was not running): `npm run build`, one uvicorn process on one port, pages + socket relay + a full browser race all work. The Docker image itself is untested locally. Next: first commit, push to GitHub, create the Render service, test with phones on mobile data. Note: free Render services sleep after ~15 min idle (first load ~1 min) and restarting loses open rooms.

- 2026-11-08: Step 7 done: GitHub repo toniedood/web_kart_game, Render Blueprint live. Step 8 plan: (a) pixel look, (b) two 2D games, (c) character customisation. 8a written: the console is called **Peaky Console**; shared `client/shared/peaky.css` (NES palette, Press Start 2P font via npm `@fontsource/press-start-2p`, brick wall, chunky buttons), `shared/logo.js`; new lobby/results/HUD/phone styles; the 3D race is drawn at 270 px height and scaled up with hard pixels (`PIXEL_ROWS` in `scene.js`), NES sky bands and track colours, pixel minimap. Verified headless (lobby, 4-way race, phone join + controller screens). Not yet pushed to GitHub/Render. Next: Toni picks one of the 3 mock-ups in `design/` (A arcade classic, B neon night, C handheld green) for the new games.
- 2026-11-08: Phone controller redesigned as a classic Game Boy-style pad (grey body, LCD showing name/lap/pos/item, D-pad that follows the thumb, A = GAS, B = BRAKE, pill = ITEM) in `client/play.html` + `client/controller/main.js`. The three mock-ups in `design/` were redone with shaded, outlined characters and detailed stages; previews of the real landing page and controller are in `design/preview-*.png`. Waiting for Toni to pick A, B or C for the new 2D games.
- 2026-11-08: Controller is now **portrait-first** (screen on top, D-pad + A/B below, ITEM pill) and still works in landscape (CSS grid + `@media (orientation: portrait)`; the old 'rotate your phone' overlay is gone). New **SETTINGS** button (join screen + pad) opens a sheet to pick colours for the console body, D-pad and A/B buttons; saved in localStorage (`peaky-style`) and applied through CSS variables (`--body`, `--dpad`, `--ab` + shades computed in `controller/main.js`). Previews: `design/preview-controller-*.png`. Verified headless in portrait, landscape and with custom colours; not yet tried on a real phone. Still to pick: design A/B/C for the new 2D games.
- 2026-11-08: Toni picked design **B (Neon Night)** for the new games. Games planned for Peaky Console: (1) Kart Race (done), (2) **Neon Brawl** 2D fighter, 2-4 players + AI (in progress: `client/host/fight/`), (3) **Hell Keep**, a Doom-style first-person shooter (built). Controller changes: D-pad has 4 real directions (`up`/`down` buttons added to the protocol; fighter: up = jump, down = block; shooter: up/down = walk), A/B closer together, bigger ITEM pill under them; button captions and the LCD labels change per game (`game` is sent in `game:phase`, `hp`/`wins` in `player:feedback`).
- 2026-11-08: **Neon Brawl** (2D fighter, design B) written: `client/host/fight/` = `game.js` (rules: walk, jump, punch, air kick, block, 60 s rounds, first to 2 round wins, bots), `sprites.js` (procedural shaded pixel fighters, jacket = player colour), `view.js` (neon city, reflections, effects, HUD). Console menu in the lobby: GAME < > picks Kart Race or Neon Brawl (`G` key too); `?game=fight&bots=3&autostart` for dev. Phone: A = punch, B or D-pad up = jump, ITEM or D-pad down = block; LCD shows HP / WINS. Verified with a headless 2-4 bot simulation and a simulated phone end to end (join, game type, HP feedback, vibration); not yet tried on real phones or deployed. Controller: arrows in all four directions, A/B closer, bigger ITEM pill under them. Next: test on phones, then the Doom-style shooter (game 3), then phone character customisation. Nothing pushed to GitHub yet since Step 7.
- 2026-11-08: First phone test of the deployed Peaky Console: pinch/double-tap zoom bug on the controller. Fixes: name input font >= 16px (iOS zooms into smaller fields and never zooms back), gesture/double-tap blocking in `controller/main.js`. Speed: both clients now use websocket-only Socket.IO; host has a debug overlay (`P` key or `?perf`) showing FPS and ping to the server. Render has no `region:` in `render.yaml`, so it runs in Oregon (US): from Europe expect ~150-200 ms ping. A region cannot be changed on an existing service; to move to Frankfurt create a new service with `region: frankfurt`.
- 2026-11-08: **Character customisation** written. Phone: CHARACTER button (next to SETTINGS) opens a sheet with a live fighter preview: hair style (spiky/wild/mohawk/flat/bald), hair colour, skin, outfit colour (or AUTO = the colour the server gave), extra (none/visor/band), Random. Saved in localStorage (`peaky-look`), sent with `player:join` and as `player:look` when changed. Server: `clean_look()` keeps only known short fields and relays; host re-checks with `cleanLook()` (`client/shared/look.js`: allowed lists, resolveLook, randomLook, botLook). Host: head preview in the lobby list; fighters (`fight/sprites.js: specFromLook`) and 3D karts (`scene.js: buildKart`: body = outfit colour, helmet = hair colour, hair cones/ridge, visor/band) use it; AI karts/fighters get preset looks. Verified headless with a mobile-size phone browser + host browser (join, change look, lobby, kart race, fight). Not yet on real phones; commit made locally.
- 2026-11-08: Character customisation pushed (commit 80aeacb). Game 3 (Doom-style shooter) mock-ups made as real raycaster renders: `design/shooter/shooter-A-hell-keep.png`, `-B-neon-station.png`, `-C-handheld-dungeon.png` (A = brown stone keep + shotgun + Doom-like face HUD; B = neon sci-fi station + plasma rifle + radar, matches Neon Brawl; C = 4 Game Boy greens, dithered, matches the phone). Waiting for Toni's pick before building. Planned controls: D-pad up/down = walk, left/right = turn, A = shoot, B = strafe/dash, ITEM = switch weapon; 2-4 players split screen, other players drawn as sprites with their phone look.
- 2026-11-08: Toni picked design **A (Hell Keep)** for the shooter and it is built: `client/host/shooter/` = `game.js` (24x24 map, deathmatch: shotgun with 7 pellets + pistol, ammo/health pickups, respawn after 3 s, first to 10 frags or 3 min, bots), `art.js` (textures + sprites drawn in code, other players drawn from their phone look), `view.js` (raycaster, split screen: 2 players = top/bottom halves, 3-4 = quarters; stone status bar with your own face). Lobby GAME row now has Kart Race / Neon Brawl / Hell Keep, with 4 bots fighting behind the menu. Phone: D-pad up/down walk, left/right turn, A (gas) fire, B (brake, hold) strafe, ITEM switch weapon; LCD shows HP, FRAGS, AMMO. `player:feedback` gained an `ammo` field. Dev: `/?game=shooter&bots=3&autostart`. Verified: Node bot simulations (2-4 bots), headless browser match, simulated phone end to end. Not yet tried on real phones; committed locally, not pushed.
- 2026-11-08: Added **back to lobby during any game** (host page): a BACK TO LOBBY button shows when the mouse moves (hides after 3 s) and `Esc` does the same; it needs a second press to confirm, then returns everyone to the lobby (`leaveGame()` in `host/main.js`). Tested headless in kart, fight and shooter. Phones have no such button (only the host can end a game). Committed locally.
- 2026-11-08: Controller steering is now a **floating joystick** (Brawl Stars style): touch anywhere in the left area, the D-pad picture appears under the thumb and the hub becomes a yellow stick that follows it (dead zone + 8 directions, same `left/right/up/down` buttons, nothing changes on the host). **Feedback on the phone:** `haptic()` helper (vibrate on Android; hidden `<input switch>` tap trick for iPhone iOS 18+, not verifiable headless), lighter tick for the stick, stronger for A/B/ITEM, LCD flashes + shakes when the host sends `vibrate` or HP drops. Verified headless with emulated touch; not yet on a real phone. Committed locally.
- 2026-11-08: **Ping work.** (1) WebRTC data channel per phone: the phone sends an offer through the server (`rtc:signal`, relayed by `server/main.py`), the host answers; after that buttons (phone -> host) and feedback (host -> phone) go directly over the channel, with the Socket.IO path as automatic fallback when the channel is not open (STUN only, no TURN, so some mobile networks will fall back). Reliable + ordered channel, so a lost "button up" can't stick a button. Host `toPhone()`, phone `openLink()` / `onFeedback()`. P overlay now shows `SERVER x MS` and `DIRECT open/players rtt MS`. (2) Compression off: `http_compression=False` in the Socket.IO server and `--ws-per-message-deflate false` in the Dockerfile CMD (Docker image still never built locally). Verified headless (host + phone tabs: channel opens, button down/up reach the host); not yet tested over a real network. Committed locally. Region is still Oregon.
- 2026-11-08: Step 9 planned (Android TV app + lowest ping): 9.1 Frankfurt region + measurements, 9.2 Capacitor TV wrapper with remote-control lobby, 9.3 optional offline Home mode. Since the WebRTC direct channel already exists, the cloud is only needed for set-up; inputs stay on the home Wi-Fi. Mode: Toni executes, AI reviews.
- 2026-11-08: **Kart graphics upgrade** (`client/host/scene.js`): 360 pixel rows instead of 270 (`?rows=270` goes back to chunkier/faster), real shadows (the sun's shadow map follows each kart's view; blob shadows kept as a faint contact shadow), kerbs + dashed centre line on the road, speckled ground texture, bigger trees (2 cones), bushes, distant snow-capped mountains that ignore fog, glossy karts with driver, arms, steering wheel, side pods, fenders, head/brake lights, rounder wheels, "?" item boxes, particles (dust, drift smoke, boost glow; pooled sprites in `createParticles`). Verified in headless screenshots (1-4 players; software GL so FPS numbers mean nothing); real-GPU speed with 4 views not yet measured. Frankfurt: not changed (see Step 8 notes: needs a new Render service).
- 2026-11-08: First ping measurement (Oregon, `P` overlay): SERVER 250–300 ms, DIRECT 20–90 ms. DIRECT should be ~5–15 ms on the same Wi-Fi; suspect phone Wi-Fi power saving, because the host only pings once per second (`setInterval(..., 1000)` in `host/main.js`), so the phone radio is asleep between pings. Test: ping every 100 ms and/or read the value while holding a button. 9.3 Home mode put on hold by Toni.
- 2026-11-08: WebRTC ping from the host is now 20 per second (was 1/s) with a smoothed RTT in the P overlay: steady traffic keeps the phones' Wi-Fi radio awake (power saving suspected for DIRECT 20-90 ms vs ~5-15 expected). Not yet measured on phones.
- 2026-11-09: **Vibration vocabulary.** Phone-side ticks on touch (stick 8-12 ms, A/B 18, ITEM 28). Host-sent buzz patterns (`BUZZ` + `buzzEvents()` in `host/main.js`): kart = GO 70, wall/kart bump = thud 40-150 ms by crash strength (throttled 250 ms), banana/rocket hit = [260,70,140], item pickup = double tap, drift boost = 3-step / 5-step rising, lap, finish; fighter = hurt [90,40,60], landed hit 35, block double tap, KO long; shooter = hurt [70,30,90], hit marker 30, shotgun recoil 55 / pistol 25. Verified headless (phone received GO then a bump thud). iPhone Safari has no `navigator.vibrate`, so iPhones only get the single tap trick (iOS 18+), no patterns.
- 2026-11-09: DIRECT still 20–90 ms after 20 pings/s. Added **9.1b Ping fixes** task list (A diagnostics via getStats, B unreliable channel with full button state, C Frankfurt, D host frame cost if needed) for the VS Code agent, plus Toni's network checks (Mac AWDL/Ethernet, 5 GHz, Low Power Mode).
- 2026-11-09: **9.1b Task A done.** `P` overlay now shows `FPS / SLOWEST FRAME ms / SERVER ms` and one line per phone: `NAME DIRECT js x / net y / peak z MS route` (js = our ping/pong, net = `getStats()` candidate-pair currentRoundTripTime, peak = worst js rtt in the last 5 s, route = e.g. host-host). Verified headless (host-host, ~0 ms on one machine). Needs a real-network reading to apply the "Reading the result" rules.
- 2026-11-09: **9.1b Task B done.** Phone keeps all button states as a bit mask and sends it with a sequence number on an unreliable data channel `state` (on every change, every 50 ms while held, 100 ms after release); every change is also sent on the reliable channel with the same number as a safety net. Host `applyState()` drops copies older than the newest seen and applies only real changes; Socket.IO `{btn, down}` stays the last fallback. Verified headless with simulated packet loss (patched `send`): 0 / 60 / 95 % loss -> 0 stuck buttons and 0 missed presses in 40 quick press/release cycles. (A first version with only repeats left 6/40 stuck at 60 % loss; the reliable copy fixed it.) Protocol table updated.
- 2026-11-09: **9.1b Task C (code part) done.** `render.yaml`: service renamed `peaky-console`, `region: frankfurt`. Nothing is live yet: Toni still has to do Render -> New -> Blueprint -> this repo, check `/healthz`, test (`P` overlay: SERVER should be ~30-40 ms), then delete the old `kart-game` Oregon service and put the new URL in this file. Task D not started on purpose: it only applies if the new overlay shows net low / js high on real devices.
- 2026-11-09: Added a "Toni's to-do (next session)" section above the status log (Frankfurt service steps + overlay readings). Toni will do it on 2026-11-10.
