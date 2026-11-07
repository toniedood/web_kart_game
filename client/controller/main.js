import { io } from "socket.io-client";
import { EVENTS } from "../shared/events.js";

const socket = io();
const code = new URLSearchParams(location.search).get("room");
const KEY = "kart-session";

const $ = (id) => document.getElementById(id);
const joinScreen = $("join");
const padScreen = $("pad");

const PHASE_TEXT = {
  lobby: "Waiting for start…",
  countdown: "Get ready!",
  race: "Go!",
  results: "Finished",
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

function releaseAll() {
  for (const button of held) send(button, false);
}
window.addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => document.hidden && releaseAll());

// --- feedback from the host ---
socket.on(EVENTS.GAME_PHASE, ({ phase }) => {
  $("phase").textContent = PHASE_TEXT[phase] ?? phase;
  if (phase === "lobby") {
    $("lap").textContent = "-";
    $("pos").textContent = "-";
    $("item").textContent = "-";
  }
});

const ITEM_NAMES = { boost: "BOOST", banana: "BANANA", rocket: "ROCKET" };

socket.on(EVENTS.PLAYER_FEEDBACK, ({ lap, position, item, vibrate }) => {
  if (lap !== undefined) $("lap").textContent = lap;
  if (position !== undefined) $("pos").textContent = position;
  $("item").textContent = ITEM_NAMES[item] ?? "-";
  if (vibrate) navigator.vibrate?.(vibrate);
});

socket.on(EVENTS.ROOM_CLOSED, () => {
  localStorage.removeItem(KEY);
  releaseAll();
  $("error").textContent = "The host closed the room.";
  show(joinScreen);
});
