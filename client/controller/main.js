import { io } from "socket.io-client";
import { EVENTS, RTC_CONFIG } from "../shared/events.js";
import { colourLogos } from "../shared/logo.js";
import { HAIR_STYLES, ACCESSORIES, HAIR_COLORS, SKINS, OUTFITS, cleanLook, resolveLook, randomLook } from "../shared/look.js";
import { drawFighter, specFromLook, POSES } from "../host/fight/sprites.js";

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

// the character chosen on this phone (kept between visits)
const LOOK_KEY = "peaky-look";
let look = randomLook();
try {
  const stored = JSON.parse(localStorage.getItem(LOOK_KEY));
  if (stored) look = cleanLook(stored);
} catch {}
let joined = false;
let myColor = loadSession()?.color ?? "#e53935"; // the colour the server gave this player, used when the outfit is on AUTO

// --- WebRTC: a direct line to the host screen ---
// Buttons go over this data channel when it is open (no detour through the server); otherwise over the socket.
let pc = null;
let channel = null;
function openLink() {
  pc?.close();
  const mine = new RTCPeerConnection(RTC_CONFIG);
  pc = mine;
  channel = null;
  const ch = mine.createDataChannel("peaky"); // reliable + ordered: a lost "button up" would leave a button stuck
  ch.onopen = () => (channel = ch);
  ch.onclose = () => channel === ch && (channel = null);
  ch.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.ping) ch.send(JSON.stringify({ pong: msg.ping }));
    else onFeedback(msg);
  };
  mine.onicecandidate = (e) => e.candidate && socket.emit(EVENTS.RTC_SIGNAL, { data: { candidate: e.candidate } });
  mine
    .createOffer()
    .then((offer) => mine.setLocalDescription(offer))
    .then(() => socket.emit(EVENTS.RTC_SIGNAL, { data: { sdp: mine.localDescription } }))
    .catch((err) => console.warn("rtc", err));
}
socket.on(EVENTS.RTC_SIGNAL, ({ data }) => {
  if (data?.sdp) pc?.setRemoteDescription(data.sdp).catch(() => {});
  else if (data?.candidate) pc?.addIceCandidate(data.candidate).catch(() => {});
});
socket.on("disconnect", () => {
  pc?.close();
  pc = channel = null;
});

function join(name, saved) {
  socket.emit(
    EVENTS.PLAYER_JOIN,
    { code, name, playerId: saved?.playerId, color: saved?.color, look },
    (res) => {
      if (!res.ok) {
        $("error").textContent = res.error;
        localStorage.removeItem(KEY);
        show(joinScreen);
        return;
      }
      localStorage.setItem(KEY, JSON.stringify({ code, playerId: res.playerId, name, color: res.color }));
      joined = true;
      myColor = res.color;
      drawPreview();
      document.documentElement.style.setProperty("--accent", res.color);
      $("who").textContent = name || "Player";
      $("phase").textContent = PHASE_TEXT.lobby;
      show(padScreen);
      openLink();
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
socket.on("disconnect", () => (joined = false));
socket.on("connect", () => {
  const saved = loadSession();
  if (saved) join(saved.name, saved);
});

// --- buttons ---
const held = new Set();

// Phone feedback: vibration where the browser allows it (Android); iPhone Safari has no vibrate(),
// but a hidden "switch" checkbox gives a tap when it is toggled from a touch (iOS 18+).
let tickLabel = null;
function haptic(ms) {
  if (navigator.vibrate) return navigator.vibrate(ms);
  try {
    if (!tickLabel) {
      tickLabel = document.createElement("label");
      tickLabel.style.cssText = "position:fixed;left:-99px;top:-99px;opacity:0;pointer-events:none";
      tickLabel.innerHTML = '<input type="checkbox" switch>';
      document.body.append(tickLabel);
    }
    tickLabel.click();
  } catch {}
}

function send(button, down) {
  if (down === button.classList.contains("down")) return;
  button.classList.toggle("down", down);
  const msg = { btn: button.dataset.btn, down };
  if (channel?.readyState === "open") channel.send(JSON.stringify(msg));
  else socket.emit(EVENTS.INPUT, msg);
  if (down) haptic(dpad.contains(button) ? 8 : button.id === "itemBtn" ? 28 : 18);
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

// The D-pad is a floating joystick (like Brawl Stars): touch anywhere in its area, the pad appears under
// the thumb and the stick follows. Pushing past the dead zone presses the direction buttons (8 ways).
const wrap = $("dpadWrap");
const dpad = $("dpad");
const dirButtons = Object.fromEntries(["left", "right", "up", "down"].map((d) => [d, dpad.querySelector(`[data-btn="${d}"]`)]));
let stick = null; // { id, x, y } = the pointer and where the thumb first landed

function setVars(vars) {
  for (const [k, v] of Object.entries(vars)) dpad.style.setProperty(k, `${v}px`);
}
function stickStart(e) {
  const r = wrap.getBoundingClientRect();
  const half = dpad.offsetWidth / 2;
  // keep the whole picture inside the touch area
  const x = Math.min(Math.max(e.clientX, r.left + half), r.right - half);
  const y = Math.min(Math.max(e.clientY, r.top + half), r.bottom - half);
  // directions are measured from where the thumb landed; the picture may sit a bit off to stay on screen
  stick = { id: e.pointerId, x: e.clientX, y: e.clientY, offX: e.clientX - x, offY: e.clientY - y };
  dpad.classList.remove("glide");
  dpad.classList.add("live");
  setVars({ "--jx": x - (r.left + r.width / 2), "--jy": y - (r.top + r.height / 2), "--kx": stick.offX, "--ky": stick.offY });
  haptic(12);
}
function stickMove(e) {
  const max = dpad.offsetWidth * 0.32;
  let dx = e.clientX - stick.x;
  let dy = e.clientY - stick.y;
  const len = Math.hypot(dx, dy);
  const k = len > max ? max / len : 1;
  setVars({ "--kx": dx * k + stick.offX, "--ky": dy * k + stick.offY });
  const active = len > max * 0.3;
  const nx = active ? dx / len : 0;
  const ny = active ? dy / len : 0;
  send(dirButtons.left, nx < -0.38);
  send(dirButtons.right, nx > 0.38);
  send(dirButtons.up, ny < -0.38);
  send(dirButtons.down, ny > 0.38);
}
function stickEnd() {
  stick = null;
  dpad.classList.add("glide");
  dpad.classList.remove("live");
  setVars({ "--jx": 0, "--jy": 0, "--kx": 0, "--ky": 0 });
  for (const b of Object.values(dirButtons)) send(b, false);
}
wrap.addEventListener("pointerdown", (e) => {
  if (stick) return;
  wrap.setPointerCapture(e.pointerId);
  stickStart(e);
  stickMove(e);
});
wrap.addEventListener("pointermove", (e) => stick && e.pointerId === stick.id && stickMove(e));
for (const type of ["pointerup", "pointercancel"]) {
  wrap.addEventListener(type, (e) => stick && e.pointerId === stick.id && stickEnd());
}
wrap.addEventListener("contextmenu", (e) => e.preventDefault());

function releaseAll() {
  for (const button of held) send(button, false);
  if (stick) stickEnd();
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

// --- character sheet ---
function saveLook() {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  } catch {}
  if (joined) socket.emit(EVENTS.PLAYER_LOOK, { look });
}

function drawPreview() {
  const canvas = $("charPreview");
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = false;
  const sky = g.createLinearGradient(0, 0, 0, 200);
  sky.addColorStop(0, "#1c0a3e");
  sky.addColorStop(1, "#7a1f84");
  g.fillStyle = sky;
  g.fillRect(0, 0, 240, 200);
  g.fillStyle = "#0a0418";
  g.fillRect(0, 168, 240, 32);
  g.fillStyle = "#00f0ff";
  g.fillRect(0, 168, 240, 1);
  const sprite = drawFighter(specFromLook(resolveLook(look, myColor)), POSES.idle, false);
  g.drawImage(sprite, 0, 16);
}

const LOOK_UI = [
  { key: "hairStyle", kind: "opts", names: HAIR_STYLES },
  { key: "hairColor", kind: "swatches", values: HAIR_COLORS },
  { key: "skin", kind: "swatches", values: SKINS },
  { key: "outfit", kind: "swatches", values: OUTFITS, auto: true },
  { key: "accessory", kind: "opts", names: ACCESSORIES },
];

function markLookUi() {
  for (const row of LOOK_UI) {
    const box = $(row.kind === "opts" ? `opt-${row.key}` : `sw-${row.key}`);
    for (const el of box.children) el.classList.toggle("on", el.dataset.value === String(look[row.key]));
  }
  drawPreview();
}

function chooseLook(key, value) {
  look = cleanLook({ ...look, [key]: value });
  markLookUi();
  saveLook();
}

for (const row of LOOK_UI) {
  const box = $(row.kind === "opts" ? `opt-${row.key}` : `sw-${row.key}`);
  if (row.kind === "opts") {
    row.names.forEach((name, i) => {
      const b = document.createElement("button");
      b.className = "opt";
      b.textContent = name;
      b.dataset.value = String(i);
      b.addEventListener("click", () => chooseLook(row.key, i));
      box.append(b);
    });
  } else {
    if (row.auto) {
      const b = document.createElement("button");
      b.className = "swatch auto";
      b.textContent = "AUTO";
      b.dataset.value = "null";
      b.addEventListener("click", () => chooseLook(row.key, null));
      box.append(b);
    }
    for (const color of row.values) {
      const b = document.createElement("button");
      b.className = "swatch";
      b.style.background = color;
      b.dataset.value = color;
      b.addEventListener("click", () => chooseLook(row.key, color));
      box.append(b);
    }
  }
}
markLookUi();
saveLook(); // keep the first random character too

function openCharacter(open) {
  releaseAll();
  $("character").classList.toggle("hidden", !open);
  if (open) markLookUi();
}
for (const btn of document.querySelectorAll(".characterBtn")) btn.addEventListener("click", () => openCharacter(true));
$("closeCharacter").addEventListener("click", () => openCharacter(false));
$("randomLook").addEventListener("click", () => {
  look = randomLook();
  markLookUi();
  saveLook();
});

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
  shooter: { a: "HP", b: "FRAGS", c: "AMMO:", gas: "FIRE", brake: "STRAFE", item: "WEAPON" },
};
function setGameUi(game = "kart") {
  const ui = GAME_UI[game] ?? GAME_UI.kart;
  $("lblA").textContent = ui.a;
  $("lblB").textContent = ui.b;
  $("capGas").textContent = ui.gas;
  $("capBrake").textContent = ui.brake;
  $("itemBtn").textContent = ui.item;
  $("lblC").textContent = ui.c ?? "ITEM:";
  $("itemRow").classList.toggle("hidden", game !== "kart" && game !== "shooter");
}

socket.on(EVENTS.GAME_PHASE, ({ phase, game }) => {
  setGameUi(game);
  lastHp = Infinity;
  $("phase").textContent = PHASE_TEXT[phase] ?? phase;
  if (phase === "lobby") {
    $("lap").textContent = "-";
    $("pos").textContent = "-";
    $("item").textContent = "-";
  }
});

let lastHp = Infinity;
function flash(cls) {
  const lcd = $("lcd");
  lcd.classList.remove(cls);
  void lcd.offsetWidth; // restart the animation
  lcd.classList.add(cls);
}

const ITEM_NAMES = { boost: "BOOST", banana: "BANANA", rocket: "ROCKET" };

socket.on(EVENTS.PLAYER_FEEDBACK, onFeedback);
function onFeedback({ lap, position, item, hp, wins, ammo, vibrate }) {
  if (ammo !== undefined) $("item").textContent = ammo;
  if (lap !== undefined) $("lap").textContent = lap;
  if (position !== undefined) $("pos").textContent = position;
  if (hp !== undefined) $("lap").textContent = hp;
  if (wins !== undefined) $("pos").textContent = wins;
  if (item !== undefined) $("item").textContent = ITEM_NAMES[item] ?? "-";
  if (vibrate) haptic(vibrate);
  if (vibrate || (hp !== undefined && hp < lastHp)) flash("hit");
  if (hp !== undefined) lastHp = hp;
}

socket.on(EVENTS.ROOM_CLOSED, () => {
  joined = false;
  localStorage.removeItem(KEY);
  releaseAll();
  $("error").textContent = "The host closed the room.";
  show(joinScreen);
});
