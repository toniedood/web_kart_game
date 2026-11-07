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

const $ = (id) => document.getElementById(id);
const NO_INPUT = {};
const KART_COLORS = ["#e53935", "#1e88e5", "#43a047", "#fdd835"];

const params = new URLSearchParams(location.search);
const laps = Number(params.get("laps")) || LAPS; // dev: /?laps=1 for a short race

const socket = io();
const gfx = createGfx($("game"));
const audio = createAudio();

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
    li.append(p.name);
    list.append(li);
  }
  const humans = [...players.values()].filter((p) => p.connected).length;
  const ai = Math.max(0, Math.min(aiCount, MAX_PLAYERS - humans));
  $("aiCount").textContent = `${ai} AI`;
  $("trackName").textContent = TRACKS[trackIndex].name;
  $("startBtn").disabled = humans + ai === 0;
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

function setPhase(next) {
  phase = next;
  socket.emit(EVENTS.GAME_PHASE, { phase });
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

socket.on(EVENTS.PLAYER_JOINED, ({ playerId, name, color }) => {
  const known = players.get(playerId);
  if (known) Object.assign(known, { name, connected: true });
  else players.set(playerId, { id: playerId, name, color, connected: true, input: {} });
  renderLobby();
  socket.emit(EVENTS.GAME_PHASE, { phase }); // tell the (re)joined phone where we are
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
function startRace() {
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
    bot: true,
    skill: 0.88 + 0.04 * i,
  }));

  race = new Race([...humans, ...bots], track, laps);
  gfx.setRace(race);
  hud = createHud($("hud"), race.karts, track);
  audio.unlock();
  audio.startEngines(race.karts);
  lastSent.clear();
  $("lobby").classList.add("hidden");
  $("results").classList.add("hidden");
  setPhase("countdown");
}

function backToLobby() {
  audio.stopEngines();
  race = null;
  hud = null;
  $("hud").innerHTML = "";
  $("banner").textContent = "";
  gfx.clearRace();
  for (const [id, p] of players) if (!p.connected) players.delete(id);
  renderLobby();
  $("results").classList.add("hidden");
  $("lobby").classList.remove("hidden");
  setPhase("lobby");
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

function showResults() {
  const list = $("standings");
  list.innerHTML = "";
  for (const k of race.ranked) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="dot" style="background:${k.color}"></span>`;
    li.append(`${k.name}  ${k.finished ? formatTime(k.finishTime) : "DNF"}`);
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

function tick() {
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
  if (race) {
    gfx.renderRace(race, dt);
    hud.update(race);
    audio.updateEngines(race.karts, race.phase);
  } else {
    gfx.renderOverview(dt);
  }
  updateBanner();
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
window.addEventListener("keydown", (e) => {
  audio.unlock();
  if (e.code === "KeyM") {
    $("sound").textContent = audio.toggleMute() ? "Sound off (M)" : "Sound on (M)";
  } else if (e.code === "Enter" || e.code === "Space") {
    e.preventDefault();
    if (phase === "lobby" || phase === "results") startRace();
  } else if (phase === "lobby" && e.code === "ArrowLeft") selectTrack(-1);
  else if (phase === "lobby" && e.code === "ArrowRight") selectTrack(1);
  else if (phase === "lobby" && e.code === "ArrowUp") selectAi(1);
  else if (phase === "lobby" && e.code === "ArrowDown") selectAi(-1);
  else if (e.code === "KeyL" && phase === "results") backToLobby();
});

window.kartDebug = { audio, getRace: () => race }; // dev: poke at things from the console

selectTrack(0); // builds the first track (or the one in ?track=) and draws the lobby
requestAnimationFrame(frame);

// dev: /?bots=2&autostart starts a race straight away
if (params.has("autostart")) startRace();
