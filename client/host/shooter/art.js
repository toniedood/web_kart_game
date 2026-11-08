// Hell Keep art, all drawn in code: wall/floor textures and sprites as pixel arrays.
import { ell, cap, tint } from "../fight/sprites.js";

const R = (g, col, a, b, w, h) => {
  g.fillStyle = col;
  g.fillRect(a | 0, b | 0, w | 0, h | 0);
};
const rampOf = (hex) => [tint(hex, -0.62), tint(hex, -0.34), hex, tint(hex, 0.45)];
const skinRamp = (hex) => [tint(hex, -0.42), tint(hex, -0.2), hex, tint(hex, 0.3)];

let seed = 11;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const canvas = (w, h) => {
  const k = document.createElement("canvas");
  k.width = w;
  k.height = h;
  return k;
};
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
// canvas -> { w, h, u } where u is a Uint32Array of 0xAABBGGRR pixels
const pixels = (k) => {
  const d = k.getContext("2d").getImageData(0, 0, k.width, k.height);
  return { w: k.width, h: k.height, u: new Uint32Array(d.data.buffer) };
};
const texture = (draw) => {
  const k = canvas(64, 64);
  draw(k.getContext("2d"));
  return pixels(k);
};
function outline(k, col) {
  const g = k.getContext("2d");
  const w = k.width;
  const h = k.height;
  const src = g.getImageData(0, 0, w, h);
  const d = src.data;
  const out = g.createImageData(w, h);
  const q = out.data;
  const c = rgb(col);
  const A = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : d[(j * w + i) * 4 + 3]);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const n = (j * w + i) * 4;
      if (d[n + 3] > 0) {
        q[n] = d[n];
        q[n + 1] = d[n + 1];
        q[n + 2] = d[n + 2];
        q[n + 3] = 255;
      } else if (A(i - 1, j) || A(i + 1, j) || A(i, j - 1) || A(i, j + 1)) {
        q[n] = c[0];
        q[n + 1] = c[1];
        q[n + 2] = c[2];
        q[n + 3] = 255;
      }
    }
  }
  g.putImageData(out, 0, 0);
}

function bricks(g, base, mortar, vary, w = 16, h = 8) {
  R(g, mortar, 0, 0, 64, 64);
  for (let r = 0; r < 64 / h; r++) {
    const off = ((r % 2) * w) / 2;
    for (let b = -1; b < 64 / w + 1; b++) {
      const bx = b * w + off;
      const by = r * h;
      const [br, bg, bb] = rgb(base);
      const j = (rnd() - 0.5) * vary;
      R(g, `rgb(${(br + j) | 0},${(bg + j * 0.8) | 0},${(bb + j * 0.6) | 0})`, bx + 1, by + 1, w - 1, h - 1);
      R(g, "rgba(255,255,255,.16)", bx + 1, by + 1, w - 1, 1);
      R(g, "rgba(0,0,0,.25)", bx + 1, by + h - 1, w - 1, 1);
    }
  }
  for (let i = 0; i < 160; i++) R(g, rnd() < 0.5 ? "rgba(0,0,0,.18)" : "rgba(255,255,255,.08)", rnd() * 64, rnd() * 64, 1, 1);
}
function glow(g, cx, cy, r, rgbStr, a) {
  const gr = g.createRadialGradient(cx, cy, 1, cx, cy, r);
  gr.addColorStop(0, `rgba(${rgbStr},${a})`);
  gr.addColorStop(1, `rgba(${rgbStr},0)`);
  g.fillStyle = gr;
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
}

export function buildWorldArt() {
  seed = 11;
  const walls = {
    1: texture((g) => {
      bricks(g, "#7a5238", "#241208", 26);
      for (let i = 0; i < 70; i++) R(g, rnd() < 0.6 ? "#3d5a22" : "#52702c", rnd() * 64, 40 + rnd() * 24, 1 + rnd() * 2, 1);
    }),
    2: texture((g) => {
      bricks(g, "#6a4630", "#1c0e06", 22);
      R(g, "#2a1a10", 24, 8, 16, 44);
      R(g, "#111", 26, 10, 12, 40);
      for (let y = 14; y < 50; y += 9) R(g, "#3a3a46", 26, y, 12, 2);
      glow(g, 32, 26, 30, "255,150,40", 0.55);
      ell(g, 32, 22, 5, 8, ["#a02000", "#e04a00", "#ff9a1f", "#ffe27a"]);
      ell(g, 32, 25, 2.5, 4, ["#ff9a1f", "#ffd24a", "#fff0a0", "#fff"]);
      R(g, "#5a3a1a", 30, 30, 4, 10);
    }),
    3: texture((g) => {
      R(g, "#1a1210", 0, 0, 64, 64);
      bricks(g, "#4c3a30", "#120a08", 16, 32, 16);
      for (let k = 0; k < 6; k++) {
        let px = 8 + rnd() * 48;
        let py = 0;
        g.strokeStyle = `rgba(255,${(60 + rnd() * 60) | 0},0,.9)`;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(px, py);
        for (let s = 0; s < 6; s++) {
          px += (rnd() - 0.5) * 14;
          py += 11;
          g.lineTo(px, py);
        }
        g.stroke();
      }
      glow(g, 32, 32, 40, "255,80,0", 0.3);
    }),
    4: texture((g) => {
      R(g, "#2a2a32", 0, 0, 64, 64);
      for (let i = 0; i < 4; i++) R(g, "#3a3a46", 2 + i * 16, 2, 12, 60);
      R(g, "#16161c", 30, 0, 4, 64);
      for (let y = 4; y < 60; y += 8) {
        R(g, "#6a6a7a", 4, y, 56, 2);
        R(g, "#1a1a20", 4, y + 2, 56, 1);
      }
      ell(g, 32, 32, 9, 9, ["#300", "#700", "#c00", "#f66"]);
      R(g, "#fff", 30, 26, 4, 12);
    }),
  };
  const floor = texture((g) => {
    R(g, "#1a0f0a", 0, 0, 64, 64);
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        const j = (rnd() - 0.5) * 24;
        R(g, `rgb(${(96 + j) | 0},${(74 + j) | 0},${(58 + j) | 0})`, tx * 32 + 1, ty * 32 + 1, 31, 31);
        R(g, "rgba(255,255,255,.14)", tx * 32 + 1, ty * 32 + 1, 31, 1);
        R(g, "rgba(0,0,0,.28)", tx * 32 + 1, ty * 32 + 31, 31, 1);
        for (let i = 0; i < 30; i++) R(g, "rgba(0,0,0,.2)", tx * 32 + rnd() * 30, ty * 32 + rnd() * 30, 1, 1);
      }
    }
  });
  const ceil = texture((g) => {
    R(g, "#1c120c", 0, 0, 64, 64);
    for (let y = 0; y < 64; y += 8) {
      R(g, "#2c1c12", 0, y, 64, 6);
      R(g, "#1a100a", 0, y + 6, 64, 2);
      for (let i = 0; i < 10; i++) R(g, "#3c281a", rnd() * 64, y + rnd() * 5, 6, 1);
    }
  });

  const sprite = (w, h, draw) => {
    const k = canvas(w, h);
    draw(k.getContext("2d"));
    outline(k, "#000");
    return pixels(k);
  };
  const pack = (col) =>
    sprite(40, 32, (g) => {
      R(g, "#1c1c24", 6, 10, 28, 18);
      R(g, col, 8, 12, 24, 14);
      R(g, tint(col, 0.4), 8, 12, 24, 3);
      R(g, "#fff", 18, 15, 4, 8);
      R(g, "#fff", 14, 17, 12, 4);
    });
  return {
    walls,
    floor,
    ceil,
    ammo: pack("#c08020"),
    health: pack("#d02020"),
    barrel: sprite(48, 64, (g) => {
      const rp = rampOf("#4a5a3a");
      cap(g, 24, 12, 24, 52, 13, 13, rp);
      ell(g, 24, 13, 13, 4.5, rampOf(tint("#4a5a3a", 0.2)));
      for (const y of [20, 32, 44]) R(g, "#222", 11, y, 26, 2);
      ell(g, 24, 52, 13, 3.5, rp);
    }),
    // a puff of smoke/blood where a shot lands
    puff: (col) =>
      sprite(24, 24, (g) => {
        ell(g, 12, 12, 8, 8, rampOf(col));
        ell(g, 8, 9, 3, 3, rampOf(tint(col, 0.3)));
      }),
    corpse: sprite(64, 24, (g) => {
      ell(g, 32, 14, 28, 8, ["#1a0000", "#400000", "#700000", "#a00000"]);
      ell(g, 32, 12, 14, 5, ["#300000", "#600000", "#a00000", "#d02020"]);
    }),
  };
}

const SPIKES = [
  [[-2, -8, -10, -14, 3], [2, -10, -1, -20, 3], [5, -9, 10, -17, 2.6]],
  [[-3, -8, -12, -10, 3.2], [1, -10, -2, -21, 3], [5, -8, 9, -18, 2.8]],
  [[-6, -9, -8, -17, 2.4], [-2, -11, -3, -21, 2.4], [2, -11, 2, -21, 2.4], [6, -9, 7, -17, 2.4]],
  [],
  [],
];

// another player, seen from the front, in the outfit chosen on their phone (64x96)
export function buildSoldier(look) {
  const k = canvas(64, 96);
  const g = k.getContext("2d");
  const top = rampOf(look.outfit);
  const pants = rampOf("#1c2040");
  const skin = skinRamp(look.skin);
  const hair = rampOf(look.hairColor);
  const metal = rampOf("#5a5e70");
  const boot = rampOf("#2a2a34");
  cap(g, 25, 60, 24, 86, 6.4, 5, pants);
  cap(g, 39, 60, 40, 86, 6.4, 5, pants);
  ell(g, 23, 90, 7.5, 4, boot);
  ell(g, 41, 90, 7.5, 4, boot);
  cap(g, 32, 32, 32, 58, 12, 10, top);
  ell(g, 32, 34, 13.5, 6, top);
  ell(g, 17, 33, 6.5, 5.5, metal);
  ell(g, 47, 33, 6.5, 5.5, metal);
  cap(g, 32, 38, 32, 54, 6, 6, metal);
  cap(g, 22, 56, 42, 56, 2.6, 2.6, hair);
  cap(g, 17, 34, 13, 48, 4.3, 3.8, top);
  cap(g, 13, 48, 16, 60, 3.6, 3.2, skin);
  ell(g, 16, 62, 4.4, 4.2, rampOf("#222222"));
  cap(g, 47, 34, 50, 47, 4.3, 3.8, top);
  cap(g, 50, 47, 42, 52, 3.6, 3.2, skin);
  ell(g, 41, 52, 4.4, 4.2, rampOf("#222222"));
  cap(g, 41, 52, 29, 52, 3, 3.4, metal); // the gun points at you
  cap(g, 36, 52, 29, 52, 1.4, 1.4, rampOf("#111111"));
  ell(g, 29, 52, 2.6, 2.6, rampOf("#111111"));
  cap(g, 32, 24, 32, 29, 4, 4, skin);
  ell(g, 32, 17, 8, 9.2, skin);
  if (look.hairStyle < 4) {
    if (look.hairStyle !== 2) ell(g, 32, 13, 9.2, 7.2, hair);
    for (const s of SPIKES[look.hairStyle] ?? []) cap(g, 32 + s[0], 17 + s[1], 32 + s[2], 17 + s[3], s[4], 0.6, hair);
  }
  if (look.accessory === 2) cap(g, 23, 12, 41, 12, 1.7, 1.7, hair);
  if (look.accessory === 1) {
    cap(g, 24, 17.5, 40, 17.5, 2.4, 2.2, hair);
  } else {
    R(g, "#fff", 27, 16, 4, 3);
    R(g, "#fff", 34, 16, 4, 3);
    R(g, "#000", 29, 16, 2, 3);
    R(g, "#000", 35, 16, 2, 3);
    cap(g, 26, 14.4, 31, 14.8, 0.7, 0.7, rampOf("#000000"));
    cap(g, 34, 14.8, 39, 14.4, 0.7, 0.7, rampOf("#000000"));
  }
  cap(g, 29, 23, 35, 23, 0.6, 0.6, rampOf("#550000"));
  outline(k, "#050010");
  return pixels(k);
}

// the weapon in your hands (drawn on the 2D canvas, 320x180 design space, centre x = 160)
export function drawWeapon(g, weapon, flash) {
  const steel = ["#101014", "#2a2a32", "#4a4a56", "#a0a0b0"];
  const wood = ["#2c1608", "#5a3014", "#8a4a1e", "#c08040"];
  const skin = ["#6a3a20", "#a86a40", "#e0a47a", "#ffd8b8"];
  const star = (cx, cy, r, col) => {
    g.fillStyle = col;
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const rr = i % 2 ? r * 0.45 : r;
      g.lineTo((cx + Math.cos(a) * rr) | 0, (cy + Math.sin(a) * rr * 0.8) | 0);
    }
    g.closePath();
    g.fill();
  };
  if (weapon === 0) {
    if (flash) {
      const gl = g.createRadialGradient(160, 86, 2, 160, 86, 40);
      gl.addColorStop(0, "rgba(255,220,100,.85)");
      gl.addColorStop(1, "rgba(255,120,20,0)");
      g.fillStyle = gl;
      g.fillRect(110, 40, 100, 90);
      star(160, 84, 24, "#ff7a18");
      star(160, 84, 17, "#ffd34a");
      star(160, 84, 9, "#fff6c0");
    }
    cap(g, 153, 150, 154, 98, 5.2, 4.4, steel);
    cap(g, 167, 150, 166, 98, 5.2, 4.4, steel);
    R(g, "#000", 150, 96, 7, 3);
    R(g, "#000", 163, 96, 7, 3);
    R(g, "#1a1a20", 157, 100, 6, 48);
    ell(g, 160, 150, 26, 12, steel);
    ell(g, flash ? 160 : 160, flash ? 136 : 130, 14, 8, wood);
    R(g, "#2c1608", 147, 128, 26, 2);
    cap(g, 160, 176, 160, 152, 20, 16, wood);
    ell(g, 128, 176, 28, 15, skin);
    ell(g, 192, 176, 28, 15, skin);
  } else {
    if (flash) {
      star(160, 108, 14, "#ff7a18");
      star(160, 108, 9, "#ffd34a");
      star(160, 108, 4, "#fff6c0");
    }
    cap(g, 160, 146, 160, 118, 7, 6, steel);
    R(g, "#000", 157, 116, 6, 3);
    R(g, "#a0a0b0", 158, 122, 2, 24);
    ell(g, 160, 150, 14, 9, steel);
    cap(g, 160, 176, 160, 152, 14, 12, wood);
    ell(g, 142, 178, 22, 14, skin);
    ell(g, 178, 178, 22, 14, skin);
  }
}
