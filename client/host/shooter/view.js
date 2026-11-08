// Hell Keep renderer: a classic raycaster (textured walls, floor and ceiling, sprites),
// drawn once per player into a split screen on a 640x360 canvas.
import { MAP, MAP_W, MAP_H } from "./game.js";
import { buildWorldArt, buildSoldier, drawWeapon } from "./art.js";
import { headshot } from "../fight/sprites.js";
import { resolveLook } from "../../shared/look.js";

const W = 640;
const H = 360;
const BAR = 22; // height of the status bar at the bottom of every view
const FOG = [0x15, 0x06, 0x00];
const FOG_DIST = 17;
const FONT = "'Press Start 2P', monospace";

function viewsFor(n) {
  if (n <= 2) return [[0, 0, 640, 180], [0, 180, 640, 180]];
  return [[0, 0, 320, 180], [320, 0, 320, 180], [0, 180, 320, 180], [320, 180, 320, 180]];
}

const text = (g, s, x, y, col, size, align = "left", shadow = "#000") => {
  g.font = `${size}px ${FONT}`;
  g.textAlign = align;
  if (shadow) {
    g.fillStyle = shadow;
    g.fillText(s, x + 1, y + 1);
  }
  g.fillStyle = col;
  g.fillText(s, x, y);
};

export function createShooterView(canvas) {
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = false;
  let art = null;
  let soldiers = new Map(); // player id -> sprite
  let faces = new Map(); // player id -> head canvas
  let buffers = new Map(); // "WxH" -> { img, buf, zb }
  let puffs = []; // { x, y, kind, age }
  let feedFlash = 0;

  function prepare(game) {
    art = art ?? buildWorldArt();
    puffs = [];
    soldiers = new Map();
    faces = new Map();
    for (const p of game.players) {
      const look = resolveLook(p.look, p.color);
      soldiers.set(p.id, buildSoldier(look));
      faces.set(p.id, headshot(look));
    }
    art.puffDust = art.puffDust ?? art.puff("#9a9aa0");
    art.puffBlood = art.puffBlood ?? art.puff("#b01818");
  }

  function onEvent(e) {
    if (e.type === "puff") puffs.push({ x: e.x, y: e.y, kind: e.kind, age: 0 });
    if (e.type === "ko") feedFlash = 0.4;
  }

  function bufferFor(w, h) {
    const key = `${w}x${h}`;
    if (!buffers.has(key)) {
      const img = new ImageData(w, h);
      buffers.set(key, { img, buf: new Uint32Array(img.data.buffer), zb: new Float32Array(w) });
    }
    return buffers.get(key);
  }

  // the 3D scene for one player, written into the pixel buffer
  function raycast(p, w, h, game) {
    const { img, buf, zb } = bufferFor(w, h);
    const plane = Math.min(1.2, 0.5 * (w / h) * 0.9);
    const proj = w / (2 * plane); // pixels per world unit at distance 1
    const dx = Math.cos(p.angle);
    const dy = Math.sin(p.angle);
    const px = -dy * plane;
    const py = dx * plane;
    const mix = (c, f, mul) => {
      const r = (c & 255) * mul;
      const gg = ((c >> 8) & 255) * mul;
      const b = ((c >> 16) & 255) * mul;
      return 0xff000000 | (((b + (FOG[2] - b) * f) | 0) << 16) | (((gg + (FOG[1] - gg) * f) | 0) << 8) | ((r + (FOG[0] - r) * f) | 0);
    };
    const half = h / 2;
    // floor and ceiling
    for (let y = Math.ceil(half - 0.5); y < h; y++) {
      const rowDist = (0.5 * proj) / (y + 0.5 - half);
      const stepX = (rowDist * 2 * px) / w;
      const stepY = (rowDist * 2 * py) / w;
      let fx = p.x + rowDist * (dx - px);
      let fy = p.y + rowDist * (dy - py);
      const f = Math.min(1, rowDist / FOG_DIST);
      for (let i = 0; i < w; i++) {
        const tx = ((fx - Math.floor(fx)) * 64) & 63;
        const ty = ((fy - Math.floor(fy)) * 64) & 63;
        fx += stepX;
        fy += stepY;
        buf[y * w + i] = mix(art.floor.u[ty * 64 + tx], f, 1.05);
        buf[(h - y - 1) * w + i] = mix(art.ceil.u[ty * 64 + tx], f, 0.8);
      }
    }
    // walls
    for (let i = 0; i < w; i++) {
      const cx = (2 * i) / w - 1;
      const rx = dx + px * cx;
      const ry = dy + py * cx;
      let mx = p.x | 0;
      let my = p.y | 0;
      const ddx = Math.abs(1 / (rx || 1e-9));
      const ddy = Math.abs(1 / (ry || 1e-9));
      let sx;
      let sy;
      let sdx;
      let sdy;
      if (rx < 0) {
        sx = -1;
        sdx = (p.x - mx) * ddx;
      } else {
        sx = 1;
        sdx = (mx + 1 - p.x) * ddx;
      }
      if (ry < 0) {
        sy = -1;
        sdy = (p.y - my) * ddy;
      } else {
        sy = 1;
        sdy = (my + 1 - p.y) * ddy;
      }
      let side = 0;
      let hit = 0;
      while (!hit) {
        if (sdx < sdy) {
          sdx += ddx;
          mx += sx;
          side = 0;
        } else {
          sdy += ddy;
          my += sy;
          side = 1;
        }
        if (mx < 0 || my < 0 || mx >= MAP_W || my >= MAP_H) hit = 1;
        else hit = MAP[my][mx];
      }
      const pd = Math.max(0.05, side === 0 ? sdx - ddx : sdy - ddy);
      zb[i] = pd;
      const lh = proj / pd;
      const y0 = Math.max(0, (half - lh / 2) | 0);
      const y1 = Math.min(h - 1, (half + lh / 2) | 0);
      let wx = side === 0 ? p.y + pd * ry : p.x + pd * rx;
      wx -= Math.floor(wx);
      let tx = (wx * 64) | 0;
      if ((side === 0 && rx > 0) || (side === 1 && ry < 0)) tx = 63 - tx;
      const tex = art.walls[hit] ?? art.walls[1];
      const f = Math.min(1, pd / FOG_DIST);
      const mul = (side ? 0.72 : 1) * 1.05;
      for (let y = y0; y <= y1; y++) {
        const ty = (((y - (half - lh / 2)) * 64) / lh) & 63;
        buf[y * w + i] = mix(tex.u[ty * 64 + tx], f, mul);
      }
    }
    // sprites, far to near
    const list = [];
    for (const q of game.players) {
      if (q === p) continue;
      if (q.alive) list.push({ x: q.x, y: q.y, tex: soldiers.get(q.id), scale: 0.95, flash: q.hurt > 0.2 });
      else list.push({ x: q.x, y: q.y, tex: art.corpse, scale: 0.3 });
    }
    for (const pk of game.pickups) if (pk.cooldown <= 0) list.push({ x: pk.x, y: pk.y, tex: pk.kind === "ammo" ? art.ammo : art.health, scale: 0.3 });
    for (const b of game.barrels) list.push({ x: b.x, y: b.y, tex: art.barrel, scale: 0.6 });
    for (const fx of puffs) list.push({ x: fx.x, y: fx.y, tex: fx.kind === "blood" ? art.puffBlood : art.puffDust, scale: 0.12 + fx.age * 0.5, lift: 0.35, glow: true });
    for (const s of list) s.d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
    list.sort((a, b) => b.d - a.d);
    const inv = 1 / (px * dy - dx * py);
    for (const s of list) {
      const sx = s.x - p.x;
      const sy = s.y - p.y;
      const tx = inv * (dy * sx - dx * sy);
      const ty = inv * (-py * sx + px * sy);
      if (ty <= 0.2) continue;
      const sh = (proj / ty) * s.scale;
      const sw = (sh * s.tex.w) / s.tex.h;
      const scrX = (w / 2) * (1 + tx / (ty * plane) * plane);
      const bottom = half + (0.5 * proj) / ty + (s.lift ? (s.lift * proj) / ty : 0) * -1;
      const top = bottom - sh;
      const f = Math.min(1, ty / FOG_DIST);
      const mul = s.glow ? 1.1 : Math.max(0.4, 1 - (ty / FOG_DIST) * 0.55);
      const c0 = Math.max(0, (scrX - sw / 2) | 0);
      const c1 = Math.min(w, (scrX + sw / 2) | 0);
      for (let col = c0; col < c1; col++) {
        if (ty >= zb[col]) continue;
        const u = (((col - (scrX - sw / 2)) * s.tex.w) / sw) | 0;
        const yA = Math.max(0, top | 0);
        const yB = Math.min(h, bottom | 0);
        for (let y = yA; y < yB; y++) {
          const v = (((y - top) * s.tex.h) / sh) | 0;
          let c = s.tex.u[v * s.tex.w + u];
          if (c >>> 24 < 128) continue;
          if (s.flash) {
            const r = c & 255;
            const gg = (c >> 8) & 255;
            const b = (c >> 16) & 255;
            c = 0xff000000 | (((b + (255 - b) * 0.5) | 0) << 16) | (((gg + (255 - gg) * 0.45) | 0) << 8) | ((r + (255 - r) * 0.65) | 0);
          }
          buf[y * w + col] = s.glow ? c : mix(c, f * 0.8, mul);
        }
      }
    }
    return img;
  }

  function drawView(view, p, game, time) {
    const [vx, vy, vw, vh] = view;
    const h3 = vh - BAR;
    g.putImageData(raycast(p, vw, h3, game), vx, vy);
    // weapon
    g.save();
    g.beginPath();
    g.rect(vx, vy, vw, h3);
    g.clip();
    const bobX = p.moving ? Math.sin(p.bob) * 4 : 0;
    const bobY = p.moving ? Math.abs(Math.cos(p.bob)) * 3 : 0;
    g.translate(vx + vw / 2 - 160 + bobX, vy + h3 - 150 + bobY + (p.flash > 0 ? 4 : 0));
    if (p.alive) drawWeapon(g, p.weapon, p.flash > 0);
    g.restore();
    // crosshair and hit marker
    const cx = vx + vw / 2;
    const cy = vy + h3 / 2;
    g.fillStyle = "#fff";
    g.fillRect(cx - 1, cy - 4, 2, 3);
    g.fillRect(cx - 1, cy + 2, 2, 3);
    g.fillRect(cx - 4, cy - 1, 3, 2);
    g.fillRect(cx + 2, cy - 1, 3, 2);
    if (p.hitMark > 0) {
      g.fillStyle = "#ff3020";
      for (const [ox, oy] of [[-6, -6], [5, -6], [-6, 5], [5, 5]]) g.fillRect(cx + ox, cy + oy, 2, 2);
    }
    // damage / death tint
    if (p.hurt > 0 || !p.alive) {
      g.fillStyle = `rgba(200,0,0,${p.alive ? p.hurt * 0.8 : 0.55})`;
      g.fillRect(vx, vy, vw, h3);
    }
    if (!p.alive) {
      text(g, "YOU DIED", cx, vy + h3 / 2 - 4, "#ff4020", 12, "center");
      text(g, `BACK IN ${Math.max(1, Math.ceil(p.respawn))}`, cx, vy + h3 / 2 + 12, "#fff", 6, "center");
    }
    // name and the last kills
    g.fillStyle = p.color;
    g.fillRect(vx + 3, vy + 3, 4, 8);
    text(g, p.name.toUpperCase().slice(0, 10), vx + 10, vy + 11, "#fff", 8);
    game.feed.slice(-2).forEach((f, i) => text(g, f.text.toUpperCase(), vx + vw - 4, vy + 11 + i * 9, "#ff6040", 6, "right"));
    // status bar (stone)
    const by = vy + h3;
    g.fillStyle = "#2a1a10";
    g.fillRect(vx, by, vw, BAR);
    for (let i = 0; i < vw; i += 16) {
      g.fillStyle = (i / 16) % 2 ? "#3a2616" : "#33200f";
      g.fillRect(vx + i, by + 2, 16, BAR - 2);
      g.fillStyle = "#0c0604";
      g.fillRect(vx + i, by + 2, 1, BAR - 2);
    }
    g.fillStyle = "#000";
    g.fillRect(vx, by, vw, 2);
    const mid = vx + vw / 2;
    const box = (x0, w0) => {
      g.fillStyle = "#000";
      g.fillRect(x0, by + 3, w0, BAR - 4);
      g.fillStyle = "#16100a";
      g.fillRect(x0 + 1, by + 4, w0 - 2, BAR - 6);
    };
    const weapon = p.weapon === 0 ? "SHOTGUN" : "PISTOL";
    box(mid - 156, 66);
    text(g, "AMMO", mid - 151, by + 10, "#c0a050", 6, "left", null);
    text(g, p.weapon === 0 ? String(p.ammo) : "INF", mid - 151, by + 20, "#ff4020", 8, "left", "#400");
    box(mid - 86, 50);
    text(g, "FRAGS", mid - 82, by + 10, "#c0a050", 6, "left", null);
    text(g, String(p.frags), mid - 82, by + 20, "#e0c060", 8, "left", "#400");
    box(mid - 22, 44);
    const face = faces.get(p.id);
    if (face) g.drawImage(face, mid - 9, by + 3, 18, 18);
    box(mid + 28, 64);
    text(g, "HEALTH", mid + 32, by + 10, "#c0a050", 6, "left", null);
    text(g, `${Math.max(0, p.hp)}%`, mid + 32, by + 20, p.hp > 30 ? "#ff4020" : "#ff2010", 8, "left", "#400");
    box(mid + 96, 60);
    text(g, "ARMS", mid + 100, by + 10, "#c0a050", 6, "left", null);
    text(g, weapon, mid + 100, by + 20, "#e0c060", 6, "left", null);
  }

  function draw(game, dt, time) {
    for (const f of puffs) f.age += dt;
    puffs = puffs.filter((f) => f.age < 0.35);
    feedFlash = Math.max(0, feedFlash - dt);
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    if (!game) return;
    const views = viewsFor(game.players.length);
    game.players.slice(0, 4).forEach((p, i) => drawView(views[i], p, game, time));
    // the empty fourth quarter shows the score
    if (game.players.length === 3) {
      g.fillStyle = "#150a04";
      g.fillRect(320, 180, 320, 180);
      text(g, "HELL KEEP", 480, 216, "#c0a050", 12, "center");
      game.ranked.forEach((p, i) => {
        g.fillStyle = p.color;
        g.fillRect(380, 240 + i * 16, 6, 8);
        text(g, `${p.name.toUpperCase().slice(0, 8)} ${p.frags}`, 392, 248 + i * 16, "#fff", 8);
      });
    }
    // split lines
    g.fillStyle = "#000";
    if (game.players.length <= 2) g.fillRect(0, 179, W, 2);
    else {
      g.fillRect(0, 179, W, 2);
      g.fillRect(319, 0, 2, H);
    }
    // clock
    const t = Math.ceil(game.timeLeft);
    g.fillStyle = "#000";
    const cy = game.players.length <= 2 ? 8 : H / 2; // top of the screen with 2 players, the cross in the middle with 3-4
    g.fillRect(W / 2 - 22, cy - 8, 44, 16);
    text(g, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`, W / 2, cy + 4, "#ffd34a", 8, "center", null);
    if (game.phase === "intro") {
      const msg = game.phaseTime > 0.7 ? "GET READY" : "FIGHT!";
      text(g, msg, W / 2, H / 2 - 24, "#ffd34a", 16, "center", "#a02000");
    }
  }

  return { prepare, onEvent, draw };
}
