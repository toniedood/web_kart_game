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
7. Cloud deployment (Render) ← WE ARE HERE (files ready, needs GitHub push + Render setup)
8. Testing & polish

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
