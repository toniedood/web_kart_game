import random
import string
import uuid
from pathlib import Path

import socketio
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from server import events as ev

fastapi_app = FastAPI()


@fastapi_app.get("/hello")
async def hello():
    return "Hello kart"


@fastapi_app.get("/healthz")
async def healthz():
    return {"ok": True}


# Production: serve the pages that `npm run build` put in dist/.
# In development there is no dist/ and Vite (port 5173) serves the pages instead.
DIST = Path(__file__).resolve().parent.parent / "dist"
if DIST.is_dir():
    fastapi_app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @fastapi_app.get("/")
    async def host_page():
        return FileResponse(DIST / "index.html")

    @fastapi_app.get("/play")
    async def play_page():
        return FileResponse(DIST / "play.html")


# no compression: the messages are tiny, and compressing them only adds delay
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*", http_compression=False)
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)

# rooms[code] = {"host": sid, "players": {playerId: {"sid", "name", "color"}}}
rooms = {}
# sid -> {"code": ..., "playerId": ...}; playerId is None for a host
sessions = {}


LOOK_KEYS = ("hairStyle", "hairColor", "skin", "outfit", "accessory")


def clean_look(raw):
    """Keep only the known look fields with short simple values; the host checks them again."""
    if not isinstance(raw, dict):
        return {}
    return {
        k: raw[k]
        for k in LOOK_KEYS
        if isinstance(raw.get(k), (int, str)) and len(str(raw[k])) <= 12
    }


def new_code():
    while True:
        code = "".join(random.choices(string.ascii_uppercase, k=ev.CODE_LENGTH))
        if code not in rooms:
            return code


@sio.on(ev.HOST_CREATE)
async def host_create(sid):
    code = new_code()
    rooms[code] = {"host": sid, "players": {}}
    sessions[sid] = {"code": code, "playerId": None}
    return {"code": code}


@sio.on(ev.PLAYER_JOIN)
async def player_join(sid, data):
    code = str(data.get("code", "")).upper()
    room = rooms.get(code)
    if room is None:
        return {"ok": False, "error": "Room not found"}
    if len(room["players"]) >= ev.MAX_PLAYERS:
        return {"ok": False, "error": "Room is full"}

    player_id = data.get("playerId")
    if not player_id or player_id in room["players"]:
        player_id = uuid.uuid4().hex[:8]
    name = str(data.get("name", "")).strip()[:12] or "Player"
    used = {p["color"] for p in room["players"].values()}
    # a rejoining phone asks for its old colour back; it gets it if still free
    wanted = data.get("color")
    color = wanted if wanted in ev.COLORS and wanted not in used else next(
        c for c in ev.COLORS if c not in used
    )

    look = clean_look(data.get("look"))
    room["players"][player_id] = {"sid": sid, "name": name, "color": color, "look": look}
    sessions[sid] = {"code": code, "playerId": player_id}
    await sio.emit(
        ev.PLAYER_JOINED,
        {"playerId": player_id, "name": name, "color": color, "look": look},
        to=room["host"],
    )
    return {"ok": True, "playerId": player_id, "color": color}


@sio.on("latency")
async def latency(sid):
    return True  # the host times how long this answer takes


@sio.on(ev.PLAYER_LOOK)
async def on_player_look(sid, data):
    session = sessions.get(sid)
    if session is None or session["playerId"] is None:
        return
    room = rooms.get(session["code"])
    player = room["players"].get(session["playerId"]) if room else None
    if player is None:
        return
    look = clean_look(data.get("look") if isinstance(data, dict) else None)
    player["look"] = look
    await sio.emit(ev.PLAYER_LOOK, {"playerId": session["playerId"], "look": look}, to=room["host"])


@sio.on(ev.INPUT)
async def on_input(sid, data):
    session = sessions.get(sid)
    if session is None or session["playerId"] is None:
        return
    room = rooms.get(session["code"])
    if room is None:
        return
    await sio.emit(
        ev.INPUT,
        {"playerId": session["playerId"], "btn": data.get("btn"), "down": bool(data.get("down"))},
        to=room["host"],
    )


@sio.on(ev.RTC_SIGNAL)
async def on_rtc_signal(sid, data):
    """Pass WebRTC set-up messages along: phone -> host, and host -> the phone named in `playerId`."""
    session = sessions.get(sid)
    if session is None or not isinstance(data, dict):
        return
    room = rooms.get(session["code"])
    if room is None:
        return
    if session["playerId"] is not None:
        await sio.emit(ev.RTC_SIGNAL, {"playerId": session["playerId"], "data": data.get("data")}, to=room["host"])
    else:
        player = room["players"].get(data.get("playerId"))
        if player:
            await sio.emit(ev.RTC_SIGNAL, {"data": data.get("data")}, to=player["sid"])


@sio.on(ev.GAME_PHASE)
async def on_game_phase(sid, data):
    session = sessions.get(sid)
    if session is None or session["playerId"] is not None:
        return  # only the host may change the phase
    room = rooms[session["code"]]
    for player in room["players"].values():
        await sio.emit(ev.GAME_PHASE, data, to=player["sid"])


@sio.on(ev.PLAYER_FEEDBACK)
async def on_player_feedback(sid, data):
    session = sessions.get(sid)
    if session is None or session["playerId"] is not None:
        return
    player = rooms[session["code"]]["players"].get(data.get("playerId"))
    if player:
        await sio.emit(ev.PLAYER_FEEDBACK, data, to=player["sid"])


@sio.event
async def disconnect(sid):
    session = sessions.pop(sid, None)
    if session is None:
        return
    room = rooms.get(session["code"])
    if room is None:
        return
    if session["playerId"] is None:
        # host left: close the room
        for player in room["players"].values():
            sessions.pop(player["sid"], None)
            await sio.emit(ev.ROOM_CLOSED, {}, to=player["sid"])
        del rooms[session["code"]]
    else:
        room["players"].pop(session["playerId"], None)
        await sio.emit(ev.PLAYER_LEFT, {"playerId": session["playerId"]}, to=room["host"])
