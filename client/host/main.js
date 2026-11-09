import { io } from "socket.io-client";
import QRCode from "qrcode";
import { EVENTS, RTC_CONFIG } from "../shared/events.js";
import { STEP, LAPS, MAX_PLAYERS } from "./config.js";
import { TRACKS } from "./tracks.js";
import { buildTrack } from "./track.js";
import { Race } from "./race.js";
import { createGfx } from "./scene.js";
import { createHud } from "./hud.js";
import { botInput } from "./bots.js";
import { createAudio } from "./audio.js";
import { colourLogos } from "../shared/logo.js";
import { FightGame } from "./fight/game.js";
import { createFightView } from "./fight/view.js";
import { ShooterGame } from "./shooter/game.js";
import { createShooterView } from "./shooter/view.js";
import { headshot } from "./fight/sprites.js";
import { cleanLook, resolveLook, botLook } from "../shared/look.js";

const $ = (id) => document.getElementById(id);
const NO_INPUT = {};
const KART_COLORS = ["#e53935", "#1e88e5", "#43a047", "#fdd835"];

const params = new URLSearchParams(location.search);
const laps = Number(params.get("laps")) || LAPS; // dev: /?laps=1 for a short race

colourLogos();
const socket = io({ transports: ["websocket"] }); // websocket only: skips the slower HTTP polling start
const gfx = createGfx($("game"));
const audio = createAudio();
const fightView = createFightView($("fight"));
const shooterView = createShooterView($("shooter"));

// the games in the console menu
const GAMES = {
  kart: { name: "KART RACE", ai: "AI KARTS", min: 1 },
  fight: { name: "NEON BRAWL", ai: "AI FIGHTERS", min: 2 },
  shooter: { name: "HELL KEEP", ai: "AI PLAYERS", min: 2 },
};
let selectedGame = params.get("game") in GAMES ? params.get("game") : "kart"; // dev: /?game=fight or /?game=shooter
let fight = null;
let shooter = null;
let attract = null; // bots playing Hell Keep behind the lobby

// players: id -> { id, name, color, connected, input: { left, right, gas, brake, item } }
// (phones only; AI karts are added when a race starts)
const players = new Map();
let aiCount = Math.min(Number(params.get("bots")) || 0, MAX_PLAYERS); // dev: /?bots=2
const wantedTrack = (params.get("track") ?? "").toLowerCase(); // dev: /?track=desert
let trackIndex = Math.max(0, TRACKS.findIndex((t) => wantedTrack && t.name.toLowerCase().startsWith(wantedTrack)));
let track = null;
let race = null;
let hud = null;
let phase = "lobby"; // lobby -> countdown -> race -> results
const lastSent = new Map(); // player id -> "lap/position/..." last sent to the phone

// --- lobby ---
function renderLobby() {
  const list = $("players");
  list.innerHTML = "";
  for (const p of players.values()) {
    const li = document.createElement("li");
    if (!p.connected) li.className = "gone";
    li.innerHTML = `<span class="dot" style="background:${p.color}"></span>`;
    const face = document.createElement("canvas"); // a small head preview of the phone's character
    face.width = 40;
    face.height = 40;
    face.className = "head";
    face.getContext("2d").drawImage(headshot(resolveLook(p.look, p.color)), 0, 0);
    li.append(face, p.name);
    list.append(li);
  }
  const humans = [...players.values()].filter((p) => p.connected).length;
  const ai = Math.max(0, Math.min(aiCount, MAX_PLAYERS - humans));
  $("aiCount").textContent = `${ai}`;
  $("trackName").textContent = TRACKS[trackIndex].name;
  $("gameName").textContent = GAMES[selectedGame].name;
  $("aiLabel").textContent = GAMES[selectedGame].ai;
  $("tagline").textContent = GAMES[selectedGame].name;
  $("rowTrack").classList.toggle("hidden", selectedGame !== "kart");
  $("startBtn").textContent = { kart: "Start race", fight: "Start fight", shooter: "Start game" }[selectedGame];
  $("startBtn").disabled = humans + ai < GAMES[selectedGame].min;
}

function selectTrack(delta) {
  trackIndex = (trackIndex + delta + TRACKS.length) % TRACKS.length;
  track = buildTrack(TRACKS[trackIndex]);
  gfx.setTrack(track);
  renderLobby();
}

function selectAi(delta) {
  aiCount = Math.max(0, Math.min(MAX_PLAYERS, aiCount + delta));
  renderLobby();
}

function selectGame(delta) {
  const keys = Object.keys(GAMES);
  selectedGame = keys[(keys.indexOf(selectedGame) + delta + keys.length) % keys.length];
  showGameView();
  renderLobby();
  socket.emit(EVENTS.GAME_PHASE, { phase, game: selectedGame });
}

// which big canvas is visible behind the lobby
function showGameView() {
  $("fight").classList.toggle("hidden", selectedGame !== "fight");
  $("shooter").classList.toggle("hidden", selectedGame !== "shooter");
  $("game").classList.toggle("hidden", selectedGame !== "kart");
  $("ground").classList.toggle("hidden", selectedGame !== "kart" || phase !== "lobby");
  if (selectedGame === "shooter" && phase === "lobby" && !shooter) startAttract();
  else attract = null;
}

// four bots fight in Hell Keep while the lobby is open
function startAttract() {
  const bots = Array.from({ length: 4 }, (_, i) => ({
    id: `demo${i}`,
    name: `BOT ${i + 1}`,
    color: KART_COLORS[i],
    look: resolveLook(botLook(i, KART_COLORS[i]), KART_COLORS[i]),
    bot: true,
    skill: 0.7,
  }));
  attract = new ShooterGame(bots);
  attract.phase = "play";
  shooterView.prepare(attract);
}

function setPhase(next) {
  phase = next;
  socket.emit(EVENTS.GAME_PHASE, { phase, game: selectedGame });
}

socket.on("connect", () => {
  players.clear();
  renderLobby();
  socket.emit(EVENTS.HOST_CREATE, (res) => {
    $("code").textContent = res.code;
    const joinUrl = `${location.origin}/play?room=${res.code}`;
    $("url").textContent = joinUrl;
    QRCode.toCanvas($("qr"), joinUrl, { width: 200 });
  });
});

socket.on(EVENTS.PLAYER_JOINED, ({ playerId, name, color, look }) => {
  const known = players.get(playerId);
  if (known) Object.assign(known, { name, connected: true, look: cleanLook(look) });
  else players.set(playerId, { id: playerId, name, color, look: cleanLook(look), connected: true, input: {} });
  renderLobby();
  socket.emit(EVENTS.GAME_PHASE, { phase, game: selectedGame }); // tell the (re)joined phone where we are
});

// the phone changed its character in the lobby
socket.on(EVENTS.PLAYER_LOOK, ({ playerId, look }) => {
  const p = players.get(playerId);
  if (!p) return;
  p.look = cleanLook(look);
  renderLobby();
});

socket.on(EVENTS.PLAYER_LEFT, ({ playerId }) => {
  const p = players.get(playerId);
  if (!p) return;
  p.input = {};
  closeLink(playerId);
  // a refreshing phone leaves and comes back: during a race keep its kart
  if (phase === "lobby") players.delete(playerId);
  else p.connected = false;
  renderLobby();
});

function applyInput(playerId, btn, down) {
  const p = players.get(playerId);
  if (p) p.input[btn] = down;
}
socket.on(EVENTS.INPUT, ({ playerId, btn, down }) => applyInput(playerId, btn, down));

// --- WebRTC: a direct line to each phone ---
// The phone sets it up (offer) through the server; after that buttons and feedback skip the server completely.
// If the direct line is not (yet) open, everything still goes through the server.
const links = new Map(); // playerId -> { pc, channel, rtt }
function closeLink(playerId) {
  const link = links.get(playerId);
  if (!link) return;
  links.delete(playerId);
  link.pc.close();
}
function toPhone(data) {
  const channel = links.get(data.playerId)?.channel;
  if (channel?.readyState === "open") channel.send(JSON.stringify(data));
  else socket.emit(EVENTS.PLAYER_FEEDBACK, data);
}
async function onSignal({ playerId, data }) {
  if (!data) return;
  if (data.sdp?.type === "offer") {
    closeLink(playerId);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const link = { pc, channel: null, rtt: null };
    links.set(playerId, link);
    pc.onicecandidate = (e) => e.candidate && socket.emit(EVENTS.RTC_SIGNAL, { playerId, data: { candidate: e.candidate } });
    pc.ondatachannel = (e) => {
      link.channel = e.channel;
      e.channel.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.pong) {
          const rtt = performance.now() - msg.pong;
          link.rtt = link.rtt == null ? rtt : link.rtt * 0.9 + rtt * 0.1; // smoothed, because it is sampled 20 times a second
        } else applyInput(playerId, msg.btn, msg.down);
      };
    };
    await pc.setRemoteDescription(data.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    socket.emit(EVENTS.RTC_SIGNAL, { playerId, data: { sdp: pc.localDescription } });
  } else if (data.candidate) {
    await links.get(playerId)?.pc.addIceCandidate(data.candidate).catch(() => {});
  }
}
socket.on(EVENTS.RTC_SIGNAL, (msg) => onSignal(msg).catch((err) => console.warn("rtc", err)));
// 20 pings a second: tiny, and the steady traffic stops a phone's Wi-Fi power saving from putting its radio
// to sleep between button presses (which adds tens of ms to the first message after a pause)
setInterval(() => {
  for (const { channel } of links.values()) {
    if (channel?.readyState === "open") channel.send(JSON.stringify({ ping: performance.now() }));
  }
}, 50);

// --- race flow ---
const withLook = (p) => ({ ...p, look: resolveLook(p.look, p.color) });
function startRace() {
  if (selectedGame === "fight") startFight();
  else if (selectedGame === "shooter") startShooter();
  else startKart();
}

function startShooter() {
  if (phase !== "lobby" && phase !== "results") return;
  const humans = [...players.values()].filter((p) => p.connected).slice(0, MAX_PLAYERS);
  const ai = Math.max(0, Math.min(aiCount, MAX_PLAYERS - humans.length));
  if (humans.length + ai < GAMES.shooter.min) return;
  const free = KART_COLORS.filter((c) => !humans.some((p) => p.color === c));
  const bots = Array.from({ length: ai }, (_, i) => ({
    id: `ai${i + 1}`,
    name: `AI ${i + 1}`,
    color: free[i] ?? KART_COLORS[i],
    look: botLook(i, free[i] ?? KART_COLORS[i]),
    bot: true,
    skill: 0.6 + 0.1 * i,
  }));
  shooter = new ShooterGame([...humans.map(withLook), ...bots].map((p) => ({ ...p, look: resolveLook(p.look, p.color) })));
  attract = null;
  shooterView.prepare(shooter);
  audio.unlock();
  lastSent.clear();
  $("lobby").classList.add("hidden");
  $("ground").classList.add("hidden");
  $("results").classList.add("hidden");
  setPhase("countdown");
}

function startFight() {
  if (phase !== "lobby" && phase !== "results") return;
  const humans = [...players.values()].filter((p) => p.connected).slice(0, MAX_PLAYERS);
  const ai = Math.max(0, Math.min(aiCount, MAX_PLAYERS - humans.length));
  if (humans.length + ai < GAMES.fight.min) return;
  const free = KART_COLORS.filter((c) => !humans.some((p) => p.color === c));
  const bots = Array.from({ length: ai }, (_, i) => ({
    id: `ai${i + 1}`,
    name: `AI ${i + 1}`,
    color: free[i] ?? KART_COLORS[i],
    look: botLook(i, free[i] ?? KART_COLORS[i]),
    bot: true,
    skill: 0.7 + 0.1 * i,
  }));
  fight = new FightGame([...humans.map(withLook), ...bots]);
  fightView.prepare(fight);
  audio.unlock();
  lastSent.clear();
  $("lobby").classList.add("hidden");
  $("ground").classList.add("hidden");
  $("results").classList.add("hidden");
  setPhase("countdown");
}

function startKart() {
  if (phase !== "lobby" && phase !== "results") return;
  const humans = [...players.values()].filter((p) => p.connected).slice(0, MAX_PLAYERS);
  const ai = Math.max(0, Math.min(aiCount, MAX_PLAYERS - humans.length));
  if (humans.length + ai === 0) return;

  // AI karts take the colours the phones didn't get
  const free = KART_COLORS.filter((c) => !humans.some((p) => p.color === c));
  const bots = Array.from({ length: ai }, (_, i) => ({
    id: `ai${i + 1}`,
    name: `AI ${i + 1}`,
    color: free[i] ?? KART_COLORS[i],
    look: botLook(i, free[i] ?? KART_COLORS[i]),
    bot: true,
    skill: 0.88 + 0.04 * i,
  }));

  race = new Race([...humans.map(withLook), ...bots], track, laps);
  gfx.setRace(race);
  hud = createHud($("hud"), race.karts, track);
  audio.unlock();
  audio.startEngines(race.karts);
  lastSent.clear();
  $("lobby").classList.add("hidden");
  $("ground").classList.add("hidden");
  $("sound").classList.add("hidden");
  $("results").classList.add("hidden");
  setPhase("countdown");
}

function backToLobby() {
  audio.stopEngines();
  race = null;
  fight = null;
  shooter = null;
  hud = null;
  $("hud").innerHTML = "";
  $("banner").textContent = "";
  gfx.clearRace();
  for (const [id, p] of players) if (!p.connected) players.delete(id);
  renderLobby();
  $("results").classList.add("hidden");
  $("lobby").classList.remove("hidden");
  $("sound").classList.remove("hidden");
  setPhase("lobby");
  showGameView();
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

function showResults() {
  const list = $("standings");
  list.innerHTML = "";
  if (shooter) {
    for (const p of shooter.ranked) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="dot" style="background:${p.color}"></span>`;
      li.append(`${p.name} ${p.frags} FRAGS`);
      list.append(li);
    }
    $("results").classList.remove("hidden");
    return;
  }
  if (fight) {
    for (const f of fight.ranked) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="dot" style="background:${f.color}"></span>`;
      li.append(`${f.name} ${f.wins} WIN${f.wins === 1 ? "" : "S"}`);
      list.append(li);
    }
    $("results").classList.remove("hidden");
    return;
  }
  for (const k of race.ranked) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="dot" style="background:${k.color}"></span>`;
    li.append(`${k.name} ${k.finished ? formatTime(k.finishTime) : "DNF"}`);
    list.append(li);
  }
  $("results").classList.remove("hidden");
}

function getInput(kart) {
  if (kart.bot) return botInput(kart, track, race.karts);
  const p = players.get(kart.id);
  return p?.connected ? p.input : NO_INPUT;
}

// tell each phone its lap, position and item when they change
function sendFeedback() {
  for (const k of race.karts) {
    if (k.bot) continue;
    const key = `${k.lap}/${k.position}/${k.finished}/${k.item}`;
    const before = lastSent.get(k.id);
    if (key === before) continue;
    lastSent.set(k.id, key);
    const lapChanged = before !== undefined && before.split("/")[0] !== String(k.lap);
    const vibrate = k.finished ? [150, 80, 150] : lapChanged ? 120 : undefined;
    toPhone({
      playerId: k.id,
      lap: k.lap,
      position: k.position,
      item: k.item,
      vibrate,
    });
  }
}

// Buzz patterns on the phone (ms on, off, on...). Pressing a button is a tiny tick (done on the phone itself);
// these are the "something happened to you" buzzes, each with its own rhythm so you can feel which it was.
const BUZZ = {
  hit: [260, 70, 140], // banana / rocket: long, wobbly
  pickup: [20, 50, 20], // item box: double tap
  boost1: [30, 30, 60],
  boost2: [40, 30, 40, 30, 110], // bigger drift boost: rising
  lap: [50, 70, 50],
  finish: [120, 60, 120, 60, 320],
  go: 70,
};
const lastBump = new Map();
function buzzEvents(events) {
  const now = performance.now();
  for (const e of events) {
    if (e.type === "go") {
      for (const k of race.karts) if (!k.bot) toPhone({ playerId: k.id, vibrate: BUZZ.go });
      continue;
    }
    if (race.karts.find((k) => k.id === e.id)?.bot !== false) continue; // humans only
    let vibrate = null;
    if (e.type === "hit") vibrate = BUZZ.hit;
    else if (e.type === "pickup") vibrate = BUZZ.pickup;
    else if (e.type === "driftboost") vibrate = e.level > 1 ? BUZZ.boost2 : BUZZ.boost1;
    else if (e.type === "lap") vibrate = BUZZ.lap;
    else if (e.type === "finish") vibrate = BUZZ.finish;
    else if (e.type === "bump" && now - (lastBump.get(e.id) ?? 0) > 250) {
      // wall or kart crash: a short thud, harder for a harder crash
      lastBump.set(e.id, now);
      vibrate = Math.round(Math.min(40 + e.strength * 4, 150));
    }
    if (vibrate) toPhone({ playerId: e.id, vibrate });
  }
}

// phone buttons -> fighter inputs
function getFightInput(f) {
  const p = players.get(f.id);
  return p?.connected ? p.input : NO_INPUT;
}

function tickFight() {
  for (const f of fight.fighters) f.connected = f.bot || (players.get(f.id)?.connected ?? false);
  fight.update(STEP, getFightInput);
  for (const f of fight.fighters) {
    if (f.bot) continue;
    const key = `${f.hp}/${f.wins}`;
    if (lastSent.get(f.id) === key) continue;
    lastSent.set(f.id, key);
    toPhone({ playerId: f.id, hp: f.hp, wins: f.wins });
  }
  for (const e of fight.events) {
    fightView.onEvent(e);
    audio.handle(e);
    const human = (id) => players.has(id);
    if (e.type === "hurt" && human(e.id)) toPhone({ playerId: e.id, vibrate: [90, 40, 60] }); // you got hit
    if (e.type === "hurt" && human(e.by)) toPhone({ playerId: e.by, vibrate: 35 }); // you landed a hit: short thump
    if (e.type === "block" && human(e.id)) toPhone({ playerId: e.id, vibrate: [25, 30, 25] }); // you blocked: two taps
    if (e.type === "ko" && human(e.id)) toPhone({ playerId: e.id, vibrate: [200, 100, 200] });
  }
  fight.events.length = 0;
  const next = { intro: "countdown", fight: "race", roundend: "race", results: "results" }[fight.phase];
  if (next !== phase) {
    if (next === "results") showResults();
    setPhase(next);
  }
}

function tickShooter() {
  for (const p of shooter.players) p.connected = p.bot || (players.get(p.id)?.connected ?? false);
  shooter.update(STEP, (p) => (players.get(p.id)?.connected ? players.get(p.id).input : NO_INPUT));
  for (const p of shooter.players) {
    if (p.bot) continue;
    const key = `${p.hp}/${p.frags}/${p.ammo}/${p.weapon}`;
    if (lastSent.get(p.id) === key) continue;
    lastSent.set(p.id, key);
    toPhone({ playerId: p.id, hp: p.hp, wins: p.frags, ammo: p.weapon === 0 ? p.ammo : "INF" });
  }
  for (const e of shooter.events) {
    shooterView.onEvent(e);
    audio.handle(e);
    const human = (id) => players.has(id);
    if (e.type === "hurt" && human(e.id)) toPhone({ playerId: e.id, vibrate: [70, 30, 90] }); // you got shot
    if (e.type === "hurt" && human(e.by) && e.by !== e.id) toPhone({ playerId: e.by, vibrate: 30 }); // hit marker
    if (e.type === "shot" && human(e.id)) toPhone({ playerId: e.id, vibrate: e.weapon === 0 ? 55 : 25 }); // recoil: shotgun kicks harder
    if (e.type === "ko" && human(e.id)) toPhone({ playerId: e.id, vibrate: [200, 100, 200] });
  }
  shooter.events.length = 0;
  const next = { intro: "countdown", play: "race", results: "results" }[shooter.phase];
  if (next !== phase) {
    if (next === "results") showResults();
    setPhase(next);
  }
}

function tick() {
  if (shooter) {
    tickShooter();
    return;
  }
  if (attract) {
    attract.update(STEP, () => NO_INPUT);
    attract.events.length = 0;
    for (const p of attract.players) if (!p.alive) p.respawn = Math.min(p.respawn, 1);
  }
  if (fight) {
    tickFight();
    return;
  }
  if (!race) return;
  for (const k of race.karts) k.connected = k.bot || (players.get(k.id)?.connected ?? false);
  race.update(STEP, getInput);
  sendFeedback();
  buzzEvents(race.events);
  for (const event of race.events) audio.handle(event);
  race.events.length = 0;

  if (race.phase !== phase) {
    if (race.phase === "results") showResults();
    setPhase(race.phase);
  }
}

// P shows frames per second and the round trip to the server
let perfOn = params.has("perf");
$("perf").classList.toggle("hidden", !perfOn);
let frames = 0;
let fpsSince = performance.now();
let ping = null;
setInterval(() => {
  if (!perfOn) return;
  const t = performance.now();
  socket.emit("latency", () => (ping = Math.round(performance.now() - t)));
}, 1000);
function updatePerf(now) {
  frames += 1;
  if (now - fpsSince < 1000) return;
  const direct = [...links.values()].filter((l) => l.channel?.readyState === "open");
  const rtt = direct.length ? Math.round(Math.max(...direct.map((l) => l.rtt ?? 0))) : "-";
  $("perf").textContent = `FPS ${frames}  SERVER ${ping ?? "-"} MS  DIRECT ${direct.length}/${players.size} ${rtt} MS`;
  frames = 0;
  fpsSince = now;
}

function updateBanner() {
  let text = "";
  if (race?.phase === "countdown") text = String(Math.ceil(race.countdown));
  else if (race?.phase === "race" && race.time < 1) text = "GO!";
  if ($("banner").textContent !== text) $("banner").textContent = text;
}

// --- main loop: fixed physics step, drawing once per frame ---
let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  acc += dt;
  while (acc >= STEP) {
    tick();
    acc -= STEP;
  }
  if (shooter) {
    shooterView.draw(shooter, dt, now / 1000);
  } else if (fight) {
    fightView.draw(fight, dt, now / 1000);
  } else if (race) {
    gfx.renderRace(race, dt);
    hud.update(race);
    audio.updateEngines(race.karts, race.phase);
  } else if (selectedGame === "shooter") {
    shooterView.draw(attract, dt, now / 1000);
  } else if (selectedGame === "fight") {
    fightView.draw(null, dt, now / 1000);
  } else {
    gfx.renderOverview(dt);
  }
  updateBanner();
  updatePerf(now);
  requestAnimationFrame(frame);
}

// --- leaving a game: the button shows when the mouse moves, and needs a second press to confirm ---
let menuTimer = null;
let menuArmed = false;
function hideMenuBtn() {
  $("menuBtn").classList.add("hidden");
  $("menuBtn").textContent = "BACK TO LOBBY (ESC)";
  menuArmed = false;
}
function showMenuBtn() {
  if (phase === "lobby") return;
  $("menuBtn").classList.remove("hidden");
  clearTimeout(menuTimer);
  menuTimer = setTimeout(hideMenuBtn, 3000);
}
function leaveGame() {
  if (phase === "lobby") return;
  if (!menuArmed) {
    menuArmed = true;
    $("menuBtn").textContent = "PRESS AGAIN TO LEAVE";
    showMenuBtn();
    return;
  }
  hideMenuBtn();
  backToLobby();
}
window.addEventListener("pointermove", showMenuBtn);
$("menuBtn").addEventListener("click", leaveGame);

// --- controls on the host computer ---
window.addEventListener("pointerdown", () => audio.unlock());
$("startBtn").addEventListener("click", startRace);
$("rematchBtn").addEventListener("click", startRace);
$("lobbyBtn").addEventListener("click", backToLobby);
$("trackPrev").addEventListener("click", () => selectTrack(-1));
$("trackNext").addEventListener("click", () => selectTrack(1));
$("aiLess").addEventListener("click", () => selectAi(-1));
$("aiMore").addEventListener("click", () => selectAi(1));
$("gamePrev").addEventListener("click", () => selectGame(-1));
$("gameNext").addEventListener("click", () => selectGame(1));
window.addEventListener("keydown", (e) => {
  audio.unlock();
  if (e.code === "Escape") {
    leaveGame();
  } else if (e.code === "KeyP") {
    perfOn = !perfOn;
    $("perf").classList.toggle("hidden", !perfOn);
  } else if (e.code === "KeyM") {
    $("sound").textContent = audio.toggleMute() ? "SOUND OFF (M)" : "SOUND ON (M)";
  } else if (e.code === "Enter" || e.code === "Space") {
    e.preventDefault();
    if (phase === "lobby" || phase === "results") startRace();
  } else if (phase === "lobby" && e.code === "KeyG") selectGame(1);
  else if (phase === "lobby" && e.code === "ArrowLeft") selectTrack(-1);
  else if (phase === "lobby" && e.code === "ArrowRight") selectTrack(1);
  else if (phase === "lobby" && e.code === "ArrowUp") selectAi(1);
  else if (phase === "lobby" && e.code === "ArrowDown") selectAi(-1);
  else if (e.code === "KeyL" && phase === "results") backToLobby();
});

window.kartDebug = { audio, players, links, getRace: () => race, getFight: () => fight, getShooter: () => shooter }; // dev: poke at things from the console

selectTrack(0); // builds the first track (or the one in ?track=) and draws the lobby
showGameView();
requestAnimationFrame(frame);

// dev: /?bots=2&autostart starts a race straight away
if (params.has("autostart")) startRace();
