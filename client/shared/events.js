// Event names. Mirrors server/events.py - keep both files in sync.
export const EVENTS = {
  HOST_CREATE: "host:create",
  PLAYER_JOIN: "player:join",
  PLAYER_JOINED: "player:joined",
  PLAYER_LEFT: "player:left",
  PLAYER_LOOK: "player:look",
  INPUT: "input",
  GAME_PHASE: "game:phase",
  PLAYER_FEEDBACK: "player:feedback",
  ROOM_CLOSED: "room:closed",
  RTC_SIGNAL: "rtc:signal",
};

export const BUTTONS = ["left", "right", "up", "down", "gas", "brake", "item"];

// Used by both sides to find a direct route between phone and host (WebRTC). Without a TURN relay a few
// networks cannot connect directly; then everything keeps going through the server as before.
export const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
