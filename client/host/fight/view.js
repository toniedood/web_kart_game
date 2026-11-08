import { STAGE } from "./game.js";
import { buildSprites, ORIGIN, SPRITE_W, SPRITE_H } from "./sprites.js";

const { W, H, floorY } = STAGE;
const HORIZON = 262;
const FONT = "'Press Start 2P', monospace";

const R = (g, col, a, b, w, h) => {
  g.fillStyle = col;
  g.fillRect(a | 0, b | 0, w | 0, h | 0);
};
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

function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// the night city behind the fight, drawn once
function buildBackground() {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");
  const rnd = seeded(7);
  const stops = [[20, 5, 46], [30, 8, 66], [48, 12, 88], [78, 18, 110], [120, 22, 126], [170, 26, 134]];
  for (let j = 0; j < HORIZON; j++) {
    const k = (j / HORIZON) * 5;
    const i = Math.min(4, k | 0);
    const f = k - i;
    const a = stops[i];
    const b = stops[i + 1];
    const m = (n) => Math.round(a[n] + (b[n] - a[n]) * f);
    R(g, `rgb(${m(0)},${m(1)},${m(2)})`, 0, j, W, 1);
  }
  for (let i = 0; i < 90; i++) R(g, "#fff", rnd() * W, rnd() * 120, 1, 1);
  // sun with stripes
  for (let j = 0; j < 84; j++) {
    const d = j - 42;
    const w = Math.round(Math.sqrt(42 * 42 - d * d));
    if (j > 50 && (j - 50) % 9 < (2 + (j - 50) / 12 | 0)) continue;
    const t = j / 84;
    R(g, t < 0.5 ? "#ffe14d" : t < 0.75 ? "#ffa04d" : "#ff5fa8", 320 - w, 150 + j, w * 2, 1);
  }
  const building = (x0, w, h, col, win, lit) => {
    R(g, col, x0, HORIZON - h, w, h);
    R(g, "rgba(255,255,255,0.08)", x0, HORIZON - h, 1, h);
    for (let j = HORIZON - h + 6; j < HORIZON - 4; j += 6) {
      for (let i = x0 + 3; i < x0 + w - 3; i += 5) {
        if (rnd() < lit) R(g, win[(rnd() * win.length) | 0], i, j, 2, 3);
      }
    }
  };
  for (let i = 0; i < 22; i++) building(i * 30 - 10, 26, 60 + ((i * 53) % 50), "#2a1048", ["#7a3cbf"], 0.12);
  for (let i = 0; i < 14; i++) {
    const h = 90 + ((i * 71) % 90);
    building(i * 50 - 20, 40, h, "#150626", ["#00f0ff", "#ff3d9a", "#ffe14d"], 0.28);
    if (i % 3 === 0) {
      R(g, "#150626", i * 50 - 2, HORIZON - h - 14, 2, 14);
      R(g, "#f33", i * 50 - 2, HORIZON - h - 16, 2, 2);
    }
  }
  const sign = (txt, sx, sy, col) => {
    R(g, "rgba(0,0,0,.6)", sx - 4, sy - 10, txt.length * 8 + 8, 16);
    g.globalAlpha = 0.35;
    text(g, txt, sx, sy, col, 8, "left", null);
    g.globalAlpha = 1;
    text(g, txt, sx, sy, "#fff", 8, "left", null);
    text(g, txt, sx + 1, sy + 1, col, 8, "left", null);
  };
  sign("RAMEN", 44, 138, "#ff3d9a");
  sign("ARCADE", 520, 118, "#00f0ff");
  sign("HOTEL", 560, 186, "#ffe14d");
  // street
  R(g, "#0a0418", 0, HORIZON, W, H - HORIZON);
  for (let j = HORIZON; j < H; j++) R(g, `rgba(255,61,154,${0.22 * (1 - (j - HORIZON) / 98)})`, 0, j, W, 1);
  g.strokeStyle = "rgba(0,240,255,.35)";
  for (let i = -10; i <= 10; i++) {
    g.beginPath();
    g.moveTo(320 + i * 8, HORIZON);
    g.lineTo(320 + i * 60, H);
    g.stroke();
  }
  for (let k = 0; k < 7; k++) R(g, "rgba(0,240,255,.4)", 0, HORIZON + k * k * 2.2, W, 1);
  R(g, "#ff3d9a", 0, HORIZON, W, 1);
  for (const lx of [60, 580]) {
    R(g, "#1c1030", lx, 176, 3, 86);
    R(g, "#1c1030", lx - 14, 174, 17, 3);
    const glow = g.createRadialGradient(lx - 12, 182, 2, lx - 12, 200, 60);
    glow.addColorStop(0, "rgba(255,225,120,.55)");
    glow.addColorStop(1, "rgba(255,225,120,0)");
    g.fillStyle = glow;
    g.fillRect(lx - 80, 150, 160, 150);
    R(g, "#fff6c0", lx - 16, 177, 6, 2);
  }
  return canvas;
}

function drawSpark(g, cx, cy, big, c1, c2, c3, seed) {
  const rnd = seeded(seed);
  const pts = [];
  const n = 10;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 ? big * 0.45 : big;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.85]);
  }
  const poly = (p, col) => {
    g.fillStyle = col;
    g.beginPath();
    p.forEach((q, i) => (i ? g.lineTo(q[0] | 0, q[1] | 0) : g.moveTo(q[0] | 0, q[1] | 0)));
    g.fill();
  };
  poly(pts, c1);
  poly(pts.map((p) => [cx + (p[0] - cx) * 0.7, cy + (p[1] - cy) * 0.7]), c2);
  poly(pts.map((p) => [cx + (p[0] - cx) * 0.35, cy + (p[1] - cy) * 0.35]), c3);
  for (let i = 0; i < 9; i++) {
    const a = rnd() * 6.28;
    const d = big * (1.1 + rnd());
    R(g, c2, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2 + (i % 2) * 2, 2 + (i % 2) * 2);
  }
}

export function createFightView(canvas) {
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = false;
  const background = buildBackground();
  let sprites = new Map(); // fighter id -> sprite cache
  let effects = []; // { x, h, age, life, kind }
  let shake = 0;
  let koFlash = 0;
  const rain = Array.from({ length: 110 }, (_, i) => ({ x: (i * 97) % W, y: (i * 53) % H, v: 380 + (i % 7) * 40 }));

  // draws every pose of every fighter once (a second or so), so the game never stutters
  function prepare(game) {
    sprites = new Map();
    effects = [];
    for (const f of game.fighters) sprites.set(f.id, buildSprites(f.look));
  }

  function onEvent(e) {
    if (e.type === "hurt") {
      effects.push({ x: e.x, h: e.h, age: 0, life: 0.22, kind: "hurt" });
      shake = 0.12;
    } else if (e.type === "block") {
      effects.push({ x: e.x, h: e.h, age: 0, life: 0.16, kind: "block" });
    } else if (e.type === "ko") {
      effects.push({ x: e.x, h: e.h, age: 0, life: 0.5, kind: "ko" });
      shake = 0.3;
      koFlash = 0.6;
    }
  }

  function spriteFor(f, game, time) {
    let pose = "idle";
    const winnerNow = game.phase === "roundend" && game.winner === f;
    if (!f.alive) pose = "ko";
    else if (winnerNow) pose = "win";
    else if (f.state === "hit") pose = "hit";
    else if (f.state === "punch") pose = "punch";
    else if (f.state === "kick") pose = "kick";
    else if (f.state === "block") pose = "block";
    else if (f.state === "jump") pose = "jump";
    else if (f.state === "walk") pose = Math.floor(time * 7) % 2 ? "walkA" : "walkB";
    return sprites.get(f.id)[`${pose}|${f.facing < 0 ? 1 : 0}`];
  }

  function draw(game, dt, time) {
    for (const e of effects) e.age += dt;
    effects = effects.filter((e) => e.age < e.life);
    shake = Math.max(0, shake - dt);
    koFlash = Math.max(0, koFlash - dt);

    g.save();
    if (shake > 0) g.translate(Math.round((Math.random() - 0.5) * 6 * (shake / 0.3 + 0.3)), Math.round((Math.random() - 0.5) * 4));
    g.drawImage(background, 0, 0);

    if (game) {
      const bottomIdle = sprites.get(game.fighters[0].id)?.["idle|0"]?.bottom ?? 55;
      // glow behind each fighter
      for (const f of game.fighters) {
        if (!f.alive) continue;
        const glow = g.createRadialGradient(f.x, floorY - 70 - f.h, 5, f.x, floorY - 70 - f.h, 80);
        glow.addColorStop(0, "rgba(255,61,154,.16)");
        glow.addColorStop(1, "rgba(255,61,154,0)");
        g.fillStyle = glow;
        g.fillRect(f.x - 90, floorY - 170, 180, 180);
      }
      // shadows
      for (const f of game.fighters) {
        const k = Math.max(0.35, 1 - f.h / 120);
        const rx = (f.alive ? 30 : 44) * k;
        g.fillStyle = "rgba(0,0,0,0.38)";
        for (let j = -4; j <= 4; j++) {
          const w = Math.round(rx * Math.sqrt(1 - (j / 4.4) ** 2));
          g.fillRect(f.x - w, floorY + 1 + j, w * 2, 1);
        }
      }
      const order = [...game.fighters].sort((a, b) => a.h - b.h);
      // reflections on the wet street
      g.save();
      g.beginPath();
      g.rect(0, HORIZON, W, H);
      g.clip();
      g.globalAlpha = 0.2;
      for (const f of order) {
        const spr = spriteFor(f, game, time);
        const bottom = f.alive ? bottomIdle : spr.bottom;
        const py = floorY - bottom - f.h;
        g.save();
        g.translate(0, floorY * 2 - 2);
        g.scale(1, -1);
        g.drawImage(spr, Math.round(f.x - ORIGIN.x), Math.round(py - ORIGIN.y), SPRITE_W, SPRITE_H);
        g.restore();
      }
      g.restore();
      // the fighters
      for (const f of order) {
        const spr = spriteFor(f, game, time);
        const bottom = f.alive ? bottomIdle : spr.bottom;
        const py = floorY - bottom - f.h;
        if (f.stun > 0 && Math.floor(time * 30) % 2) g.globalAlpha = 0.75;
        g.drawImage(spr, Math.round(f.x - ORIGIN.x), Math.round(py - ORIGIN.y), SPRITE_W, SPRITE_H);
        g.globalAlpha = 1;
      }
      // hit effects
      effects.forEach((e, i) => {
        const y = floorY - 60 - e.h;
        const t = e.age / e.life;
        if (e.kind === "hurt") drawSpark(g, e.x, y, 26 * (1 - t * 0.4), "#00f0ff", "#fff", "#ff3d9a", i + 3);
        else if (e.kind === "block") drawSpark(g, e.x, y, 14, "#6a78ff", "#fff", "#00f0ff", i + 9);
        else drawSpark(g, e.x, y, 44 * (0.6 + t), "#ff3d9a", "#ffe14d", "#fff", i + 5);
      });
    }

    // rain
    g.strokeStyle = "rgba(180,220,255,.28)";
    for (const d of rain) {
      d.y += d.v * dt;
      d.x -= d.v * dt * 0.35;
      if (d.y > H) {
        d.y = -8;
        d.x = Math.random() * (W + 80);
      }
      g.beginPath();
      g.moveTo(d.x | 0, d.y | 0);
      g.lineTo((d.x - 3) | 0, (d.y + 8) | 0);
      g.stroke();
    }
    g.restore();

    if (game) drawHud(game, time);
    // scanlines + vignette
    for (let y = 0; y < H; y += 3) R(g, "rgba(0,0,0,.12)", 0, y, W, 1);
    const vg = g.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, 420);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,.45)");
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    if (koFlash > 0) R(g, `rgba(255,255,255,${koFlash * 0.5})`, 0, 0, W, H);
  }

  function drawHud(game, time) {
    const n = game.fighters.length;
    const gap = 14;
    const bw = (W - 24 - gap * (n - 1)) / n;
    game.fighters.forEach((f, i) => {
      const x0 = 12 + i * (bw + gap);
      const col = f.alive ? f.color : "#555";
      g.fillStyle = "#0a0418";
      g.fillRect(x0 - 2, 10, bw + 4, 20);
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.strokeRect(x0 - 1, 11, bw + 2, 18);
      const fill = (bw - 4) * (f.hp / 100);
      R(g, "#3a0a24", x0 + 2, 14, bw - 4, 12);
      R(g, f.hp > 30 ? "#00f0ff" : "#ff3d9a", x0 + 2, 14, fill, 12);
      R(g, "rgba(255,255,255,.45)", x0 + 2, 14, fill, 3);
      for (let k = 1; k < 10; k++) R(g, "rgba(0,0,0,.4)", x0 + 2 + ((bw - 4) * k) / 10, 14, 1, 12);
      text(g, f.name.toUpperCase().slice(0, 10), x0, 46, col, 7);
      for (let k = 0; k < 2; k++) {
        R(g, "#000", x0 + bw - 20 + k * 11 - 1, 35, 10, 10);
        R(g, k < f.wins ? "#ffe14d" : "#3a2a5a", x0 + bw - 20 + k * 11, 36, 8, 8);
      }
    });
    // clock
    R(g, "#0a0418", W / 2 - 22, 52, 44, 24);
    g.strokeStyle = "#ffe14d";
    g.lineWidth = 2;
    g.strokeRect(W / 2 - 21, 53, 42, 22);
    text(g, String(Math.ceil(game.timeLeft)).padStart(2, "0"), W / 2, 70, "#ffe14d", 14, "center");

    // big messages
    if (game.phase === "intro") {
      const t = game.phaseTime;
      const msg = t > 1.2 ? `ROUND ${game.round}` : "FIGHT!";
      const pulse = 1 + Math.max(0, 0.4 - (t % 1.2) * 0.4);
      text(g, msg, W / 2, 140, "#fff", Math.round(24 * pulse), "center", "#ff3d9a");
    } else if (game.phase === "fight" && game.timeLeft > 58) {
      text(g, "FIGHT!", W / 2, 140, "#fff", 24, "center", "#ff3d9a");
    } else if (game.phase === "roundend") {
      const msg = game.winner ? `${game.winner.name.toUpperCase()} WINS!` : "DRAW";
      text(g, game.fighters.some((f) => !f.alive) ? "K.O." : "TIME", W / 2, 120, "#ff3d9a", 26, "center", "#000");
      text(g, msg, W / 2, 150, "#ffe14d", 12, "center");
    }
  }

  return { prepare, onEvent, draw };
}
