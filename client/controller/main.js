import { io } from "socket.io-client";
import { EVENTS } from "../shared/events.js";
import { colourLogos } from "../shared/logo.js";

colourLogos();

// websocket only: skips the slower HTTP polling start
const socket = io({ transports: ["websocket"] });

// iPhones ignore user-scalable=no: block pinch zoom and double-tap zoom ourselves
for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(type, (e) => e.preventDefault());
}
document.addEventListener("touchmove", (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });
let lastTouchEnd = 0;
document.addEventListener(
  "touchend",
  (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 350 && e.target.tagName !== "INPUT") e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false },
);
const code = new URLSearchParams(location.search).get("room");
const KEY = "kart-session";

const $ = (id) => document.getElementById(id);
const joinScreen = $("join");
const padScreen = $("pad");

const PHASE_TEXT = {
  lobby: "WAITING...",
  countdown: "GET READY!",
  race: "GO!",
  results: "FINISHED",
};

// session = { code, playerId, name, color }, saved so a refresh can rejoin
function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s?.code === code ? s : null;
  } catch {
    return null;
  }
}

function show(screen) {
  joinScreen.classList.toggle("active", screen === joinScreen);
  padScreen.classList.toggle("active", screen === padScreen);
}

function join(name, saved) {
  socket.emit(
    EVENTS.PLAYER_JOIN,
    { code, name, playerId: saved?.playerId, color: saved?.color },
    (res) => {
      if (!res.ok) {
        $("error").textContent = res.error;
        localStorage.removeItem(KEY);
        show(joinScreen);
        return;
      }
      localStorage.setItem(KEY, JSON.stringify({ code, playerId: res.playerId, name, color: res.color }));
      document.documentElement.style.setProperty("--accent", res.color);
      $("who").textContent = name || "Player";
      $("phase").textContent = PHASE_TEXT.lobby;
      show(padScreen);
    },
  );
}

if (!code) {
  $("error").textContent = "No room code. Scan the QR code on the TV.";
  $("joinBtn").disabled = true;
}

$("joinBtn").addEventListener("click", () => {
  const name = $("name").value.trim();
  join(name, loadSession());
});

// (re)join automatically on page refresh and after a dropped connection
socket.on("connect", () => {
  const saved = loadSession();
  if (saved) join(saved.name, saved);
});

// --- buttons ---
const held = new Set();

function send(button, down) {
  if (down === button.classList.contains("down")) return;
  button.classList.toggle("down", down);
  socket.emit(EVENTS.INPUT, { btn: button.dataset.btn, down });
  if (down) navigator.vibrate?.(10);
}

for (const button of padScreen.querySelectorAll("button")) {
  held.add(button);
  // pointer capture keeps the button pressed while the thumb slides around
  button.addEventListener("pointerdown", (e) => {
    button.setPointerCapture(e.pointerId);
    send(button, true);
  });
  button.addEventListener("pointerup", () => send(button, false));
  button.addEventListener("pointercancel", () => send(button, false));
  button.addEventListener("contextmenu", (e) => e.preventDefault());
}

// The D-pad is one touch area: sliding the thumb across it switches between left and right.
const dpad = $("dpad");
const dirButtons = Object.fromEntries(["left", "right", "up", "down"].map((d) => [d, dpad.querySelector(`[data-btn="${d}"]`)]));
function steerFrom(e) {
  const r = dpad.getBoundingClientRect();
  const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
  const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
  send(dirButtons.left, dx < -0.1);
  send(dirButtons.right, dx > 0.1);
  send(dirButtons.up, dy < -0.1);
  send(dirButtons.down, dy > 0.1);
}
dpad.addEventListener("pointerdown", (e) => {
  dpad.setPointerCapture(e.pointerId);
  steerFrom(e);
});
dpad.addEventListener("pointermove", (e) => dpad.hasPointerCapture(e.pointerId) && steerFrom(e));
for (const type of ["pointerup", "pointercancel"]) {
  dpad.addEventListener(type, () => {
    for (const b of Object.values(dirButtons)) send(b, false);
  });
}
dpad.addEventListener("contextmenu", (e) => e.preventDefault());

function releaseAll() {
  for (const button of held) send(button, false);
}
window.addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => document.hidden && releaseAll());

// --- settings: console colours, remembered on this phone ---
const STYLE_KEY = "peaky-style";
const PALETTES = {
  body: ["#cdcbc4", "#d9473c", "#f2cf3f", "#38b7a8", "#4a78d8", "#8a5ac8", "#f08ab8", "#f08a3a", "#f2f2f0", "#3a3a40"],
  dpad: ["#2c2c34", "#6a6a74", "#eeeeee", "#d22b2b", "#2f62d0", "#f0c020", "#2ea84a", "#f08ab8"],
  ab: ["#a8205a", "#d22b2b", "#2f62d0", "#2ea84a", "#f0c020", "#2c2c34", "#eeeeee", "#f08a3a"],
};
const DEFAULT_STYLE = { body: PALETTES.body[0], dpad: PALETTES.dpad[0], ab: PALETTES.ab[0] };
let style = { ...DEFAULT_STYLE };
try {
  style = { ...style, ...JSON.parse(localStorage.getItem(STYLE_KEY)) };
} catch {}

// amount -1..0 darkens, 0..1 lightens
function tint(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  return "#" + [n >> 16, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, "0")).join("");
}

function applyStyle() {
  const root = document.documentElement.style;
  root.setProperty("--body", style.body);
  root.setProperty("--body-hi", tint(style.body, 0.35));
  root.setProperty("--body-lo", tint(style.body, -0.14));
  root.setProperty("--body-dark", tint(style.body, -0.32));
  root.setProperty("--dpad", style.dpad);
  root.setProperty("--dpad-hi", tint(style.dpad, 0.3));
  root.setProperty("--dpad-lo", tint(style.dpad, -0.45));
  root.setProperty("--ab", style.ab);
  root.setProperty("--ab-hi", tint(style.ab, 0.35));
  root.setProperty("--ab-lo", tint(style.ab, -0.4));
  root.setProperty("--ab-dark", tint(style.ab, -0.6));
  try {
    localStorage.setItem(STYLE_KEY, JSON.stringify(style));
  } catch {}
  for (const part of Object.keys(PALETTES)) {
    for (const sw of document.querySelectorAll(`#sw-${part} .swatch`)) {
      sw.classList.toggle("on", sw.dataset.color === style[part]);
    }
  }
}

for (const [part, colors] of Object.entries(PALETTES)) {
  for (const color of colors) {
    const sw = document.createElement("button");
    sw.className = "swatch";
    sw.dataset.color = color;
    sw.style.background = color;
    sw.addEventListener("click", () => {
      style[part] = color;
      applyStyle();
    });
    $(`sw-${part}`).append(sw);
  }
}
applyStyle();

function openSettings(open) {
  releaseAll();
  $("settings").classList.toggle("hidden", !open);
}
for (const btn of document.querySelectorAll(".settingsBtn")) btn.addEventListener("click", () => openSettings(true));
$("closeSettings").addEventListener("click", () => openSettings(false));
$("resetStyle").addEventListener("click", () => {
  style = { ...DEFAULT_STYLE };
  applyStyle();
});

// --- feedback from the host ---
// each game labels the buttons and the screen differently
const GAME_UI = {
  kart: { a: "LAP", b: "POS", gas: "GAS", brake: "BRAKE", item: "ITEM" },
  fight: { a: "HP", b: "WINS", gas: "PUNCH", brake: "JUMP", item: "BLOCK" },
};
function setGameUi(game = "kart") {
  const ui = GAME_UI[game] ?? GAME_UI.kart;
  $("lblA").textContent = ui.a;
  $("lblB").textContent = ui.b;
  $("capGas").textContent = ui.gas;
  $("capBrake").textContent = ui.brake;
  $("itemBtn").textContent = ui.item;
  $("itemRow").classList.toggle("hidden", game !== "kart");
}

socket.on(EVENTS.GAME_PHASE, ({ phase, game }) => {
  setGameUi(game);
  $("phase").textContent = PHASE_TEXT[phase] ?? phase;
  if (phase === "lobby") {
    $("lap").textContent = "-";
    $("pos").textContent = "-";
    $("item").textContent = "-";
  }
});

const ITEM_NAMES = { boost: "BOOST", banana: "BANANA", rocket: "ROCKET" };

socket.on(EVENTS.PLAYER_FEEDBACK, ({ lap, position, item, hp, wins, vibrate }) => {
  if (lap !== undefined) $("lap").textContent = lap;
  if (position !== undefined) $("pos").textContent = position;
  if (hp !== undefined) $("lap").textContent = hp;
  if (wins !== undefined) $("pos").textContent = wins;
  if (item !== undefined) $("item").textContent = ITEM_NAMES[item] ?? "-";
  if (vibrate) navigator.vibrate?.(vibrate);
});

socket.on(EVENTS.ROOM_CLOSED, () => {
  localStorage.removeItem(KEY);
  releaseAll();
  $("error").textContent = "The host closed the room.";
  show(joinScreen);
});
