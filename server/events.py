# Event names. Mirrors client/shared/events.js - keep both files in sync.
HOST_CREATE = "host:create"
PLAYER_JOIN = "player:join"
PLAYER_JOINED = "player:joined"
PLAYER_LEFT = "player:left"
PLAYER_LOOK = "player:look"
INPUT = "input"
GAME_PHASE = "game:phase"
PLAYER_FEEDBACK = "player:feedback"
ROOM_CLOSED = "room:closed"
RTC_SIGNAL = "rtc:signal"  # WebRTC set-up messages (offer / answer / ICE), relayed between one phone and the host

MAX_PLAYERS = 4
CODE_LENGTH = 4
COLORS = ["#e53935", "#1e88e5", "#43a047", "#fdd835"]
