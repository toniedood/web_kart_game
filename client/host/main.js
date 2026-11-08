import { io } from "socket.io-client";
import QRCode from "qrcode";
import { EVENTS } from "../shared/events.js";
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

// the games in the console menu
const GAMES = {
  kart: { name: "KART RACE", ai: "AI KARTS", min: 1 },
  fight: { name: "NEON BRAWL", ai: "AI FIGHTERS", min: 2 },
};
let selectedGame = params.get("game") === "fight" ? "fight" : "kart"; // dev: /?game=fight
let fight = null;

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
  $("startBtn").textContent = selectedGame === "kart" ? "Start race" : "Start fight";
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
  const fightOn = selectedGame === "fight";
  $("fight").classList.toggle("hidden", !fightOn);
  $("game").classList.toggle("hidden", fightOn);
  $("ground").classList.toggle("hidden", fightOn || phase !== "lobby");
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
  // a refreshing phone leaves and comes back: during a race keep its kart
  if (phase === "lobby") players.delete(playerId);
  else p.connected = false;
  renderLobby();
});

socket.on(EVENTS.INPUT, ({ playerId, btn, down }) => {
  const p = players.get(playerId);
  if (p) p.input[btn] = down;
});

// --- race flow ---
const withLook = (p) => ({ ...p, look: resolveLook(p.look, p.color) });
function startRace() {
  if (selectedGame === "fight") startFight();
  else startKart();
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
    socket.emit(EVENTS.PLAYER_FEEDBACK, {
      playerId: k.id,
      lap: k.lap,
      position: k.position,
      item: k.item,
      vibrate,
    });
  }
}

// a longer buzz on the phone of a kart that was hit
function buzzHits(events) {
  for (const e of events) {
    if (e.type === "hit" && !race.karts.find((k) => k.id === e.id)?.bot) {
      socket.emit(EVENTS.PLAYER_FEEDBACK, { playerId: e.id, vibrate: 300 });
    }
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
    socket.emit(EVENTS.PLAYER_FEEDBACK, { playerId: f.id, hp: f.hp, wins: f.wins });
  }
  for (const e of fight.events) {
    fightView.onEvent(e);
    audio.handle(e);
    const human = (id) => players.has(id);
    if (e.type === "hurt" && human(e.id)) socket.emit(EVENTS.PLAYER_FEEDBACK, { playerId: e.id, vibrate: 120 });
    if (e.type === "ko" && human(e.id)) socket.emit(EVENTS.PLAYER_FEEDBACK, { playerId: e.id, vibrate: [200, 100, 200] });
  }
  fight.events.length = 0;
  const next = { intro: "countdown", fight: "race", roundend: "race", results: "results" }[fight.phase];
  if (next !== phase) {
    if (next === "results") showResults();
    setPhase(next);
  }
}

function tick() {
  if (fight) {
    tickFight();
    return;
  }
  if (!race) return;
  for (const k of race.karts) k.connected = k.bot || (players.get(k.id)?.connected ?? false);
  race.update(STEP, getInput);
  sendFeedback();
  buzzHits(race.events);
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
  $("perf").textContent = `FPS ${frames}  PING ${ping ?? "-"} MS`;
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
  if (fight) {
    fightView.draw(fight, dt, now / 1000);
  } else if (race) {
    gfx.renderRace(race, dt);
    hud.update(race);
    audio.updateEngines(race.karts, race.phase);
  } else if (selectedGame === "fight") {
    fightView.draw(null, dt, now / 1000);
  } else {
    gfx.renderOverview(dt);
  }
  updateBanner();
  updatePerf(now);
  requestAnimationFrame(frame);
}

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
  if (e.code === "KeyP") {
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

window.kartDebug = { audio, getRace: () => race, getFight: () => fight }; // dev: poke at things from the console

selectTrack(0); // builds the first track (or the one in ?track=) and draws the lobby
showGameView();
requestAnimationFrame(frame);

// dev: /?bots=2&autostart starts a race straight away
if (params.has("autostart")) startRace();
