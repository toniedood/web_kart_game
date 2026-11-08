// Procedural pixel-art fighters. A fighter is a skeleton (head, torso, arms, legs) drawn as
// shaded capsules, outlined, and cached per pose. Light always comes from the top left.
const S = 1.45; // body scale
export const SPRITE_W = 240;
export const SPRITE_H = 200;
export const ORIGIN = { x: 120, y: 122 }; // where the pelvis sits inside a sprite

const R = (g, col, a, b, w, h) => {
  g.fillStyle = col;
  g.fillRect(a | 0, b | 0, w | 0, h | 0);
};

const LX = -0.62;
const LY = -0.78;
function shade(ramp, nx, ny, r2) {
  const d = nx * LX + ny * LY;
  let k = d > 0.5 ? 3 : d > -0.05 ? 2 : d > -0.55 ? 1 : 0;
  if (r2 > 0.8 && d < -0.2) k = 0;
  return ramp[k];
}

export function ell(g, cx, cy, rx, ry, ramp) {
  for (let j = Math.floor(cy - ry); j <= cy + ry; j++) {
    for (let i = Math.floor(cx - rx); i <= cx + rx; i++) {
      const nx = (i + 0.5 - cx) / rx;
      const ny = (j + 0.5 - cy) / ry;
      const r2 = nx * nx + ny * ny;
      if (r2 <= 1) R(g, shade(ramp, nx, ny, r2), i, j, 1, 1);
    }
  }
}

// a thick line with round ends; radius changes from ra to rb
export function cap(g, ax, ay, bx, by, ra, rb, ramp) {
  const minx = Math.floor(Math.min(ax - ra, bx - rb));
  const maxx = Math.ceil(Math.max(ax + ra, bx + rb));
  const miny = Math.floor(Math.min(ay - ra, by - rb));
  const maxy = Math.ceil(Math.max(ay + ra, by + rb));
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  for (let j = miny; j <= maxy; j++) {
    for (let i = minx; i <= maxx; i++) {
      const px = i + 0.5;
      const py = j + 0.5;
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx;
      const cy = ay + t * dy;
      const r = ra + (rb - ra) * t;
      const ddx = px - cx;
      const ddy = py - cy;
      const dd = ddx * ddx + ddy * ddy;
      if (dd <= r * r) R(g, shade(ramp, ddx / r, ddy / r, dd / (r * r)), i, j, 1, 1);
    }
  }
}

// Poses are joint positions in body units, pelvis at (0,0), facing right, y up is negative.
// fa/ba = front/back arm [shoulder, elbow, hand]; fl/bl = front/back leg [hip, knee, foot].
export const POSES = {
  idle: { head: [3, -46], chest: [1, -33], waist: [0, -4], fa: [[5, -33], [14, -24], [21, -35]], ba: [[-3, -33], [6, -22], [13, -32]], fl: [[3, 0], [12, 14], [16, 30]], bl: [[-3, 0], [-9, 14], [-15, 30]] },
  walkA: { head: [4, -46], chest: [2, -33], waist: [0, -4], fa: [[5, -33], [13, -24], [20, -34]], ba: [[-3, -33], [5, -22], [12, -31]], fl: [[3, 0], [14, 12], [21, 29]], bl: [[-3, 0], [-6, 15], [-11, 30]] },
  walkB: { head: [3, -45], chest: [1, -33], waist: [0, -4], fa: [[5, -33], [14, -25], [22, -35]], ba: [[-3, -33], [6, -23], [14, -32]], fl: [[3, 0], [8, 15], [8, 30]], bl: [[-3, 0], [-13, 12], [-21, 28]] },
  punch: { head: [8, -45], chest: [5, -33], waist: [-1, -4], fa: [[8, -33], [22, -35], [39, -36]], ba: [[0, -33], [8, -24], [14, -34]], fl: [[3, 0], [16, 12], [22, 30]], bl: [[-3, 0], [-12, 14], [-22, 30]] },
  kick: { head: [-2, -46], chest: [-3, -33], waist: [0, -4], fa: [[1, -33], [9, -26], [16, -37]], ba: [[-6, -33], [1, -24], [8, -34]], fl: [[3, 0], [21, -5], [41, -12]], bl: [[-3, 0], [-4, 14], [-7, 30]] },
  jump: { head: [3, -47], chest: [1, -34], waist: [0, -4], fa: [[5, -34], [14, -32], [20, -44]], ba: [[-3, -34], [6, -30], [12, -42]], fl: [[3, 0], [15, 6], [11, 20]], bl: [[-3, 0], [-9, 8], [-13, 22]] },
  block: { head: [1, -45], chest: [0, -31], waist: [0, -4], fa: [[5, -32], [13, -30], [11, -44]], ba: [[-2, -32], [8, -28], [13, -41]], fl: [[3, 0], [14, 12], [18, 30]], bl: [[-3, 0], [-12, 12], [-18, 30]] },
  hit: { head: [-9, -43], chest: [-5, -33], waist: [1, -4], fa: [[-1, -33], [-9, -24], [-15, -13]], ba: [[-7, -33], [-17, -27], [-25, -19]], fl: [[3, 0], [8, 15], [13, 30]], bl: [[-3, 0], [-12, 14], [-21, 30]], hurt: true },
  ko: { head: [-37, -8], chest: [-22, -8], waist: [-2, -6], fa: [[-19, -12], [-27, -2], [-35, 6]], ba: [[-21, -8], [-30, -18], [-38, -22]], fl: [[3, -2], [18, -6], [35, -2]], bl: [[1, 2], [17, 4], [33, 8]], hurt: true },
  win: { head: [3, -46], chest: [1, -33], waist: [0, -4], fa: [[5, -33], [12, -46], [14, -60]], ba: [[-3, -33], [6, -22], [13, -32]], fl: [[3, 0], [12, 14], [16, 30]], bl: [[-3, 0], [-9, 14], [-15, 30]] },
};

const NAVY = ["#0a0a22", "#161640", "#24245e", "#3a3a88"];

export function tint(hex, amount) {
  const n = parseInt(/^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "888888", 16);
  const mix = (c) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  return "#" + [n >> 16, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, "0")).join("");
}

const rampOf = (hex) => [tint(hex, -0.62), tint(hex, -0.34), hex, tint(hex, 0.45)];
const skinRamp = (hex) => [tint(hex, -0.42), tint(hex, -0.2), hex, tint(hex, 0.3)];

// hair spikes per style: [x0, y0, x1, y1, thickness] in head units (see HAIR_STYLES in shared/look.js)
const SPIKES = [
  [[-2, -8, -10, -14, 3], [2, -10, -1, -20, 3], [5, -9, 10, -17, 2.6], [-5, -6, -16, -8, 2.6]], // spiky
  [[-3, -8, -12, -10, 3.2], [1, -10, -2, -21, 3], [5, -8, 9, -18, 2.8], [-6, -4, -17, -2, 2.4]], // wild
  [[-6, -9, -8, -17, 2.4], [-2, -11, -3, -21, 2.4], [2, -11, 2, -21, 2.4], [6, -9, 7, -17, 2.4]], // mohawk
  [], // flat
  [], // bald
];

// `look` is a resolved look (see resolveLook in shared/look.js): outfit is a colour
export function specFromLook(look) {
  const hair = rampOf(look.hairColor);
  return {
    skin: skinRamp(look.skin),
    top: rampOf(look.outfit),
    sleeve: true,
    pants: NAVY,
    shoe: hair,
    sole: "#000",
    glove: NAVY,
    wrap: hair,
    belt: hair,
    hair: look.hairStyle === 4 ? null : hair,
    hairCap: look.hairStyle !== 2,
    spikes: SPIKES[look.hairStyle] ?? [],
    visor: look.accessory === 1 ? [tint(look.hairColor, -0.6), tint(look.hairColor, -0.3), look.hairColor, tint(look.hairColor, 0.7)] : null,
    band: look.accessory === 2 ? hair : null,
    eye: "#000",
    brow: "#000",
    trim: look.hairColor,
    stripe: look.hairColor,
    shinStripe: true,
    vneck: false,
    outline: "#050010",
  };
}

// Draws one fighter pose to its own canvas. `flip` = facing left.
export function drawFighter(f, pose, flip) {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_W;
  canvas.height = SPRITE_H;
  const q = canvas.getContext("2d");
  const ox = ORIGIN.x;
  const oy = ORIGIN.y;
  const fx = flip ? -1 : 1;
  const X = (p) => [ox + fx * p[0] * S, oy + p[1] * S];
  const r = (n) => n * S;
  const arm = (a) => {
    const s = X(a[0]);
    const e = X(a[1]);
    const h = X(a[2]);
    cap(q, s[0], s[1], e[0], e[1], r(4.4), r(3.8), f.top);
    cap(q, e[0], e[1], h[0], h[1], r(3.7), r(3.2), f.skin);
    const wx = h[0] + (e[0] - h[0]) * 0.28;
    const wy = h[1] + (e[1] - h[1]) * 0.28;
    cap(q, wx, wy, h[0], h[1], r(3.8), r(3.8), f.wrap);
    ell(q, h[0] + fx, h[1], r(4.6), r(4.3), f.glove);
  };
  const leg = (h0, k0, f0) => {
    const hp = X(h0);
    const kn = X(k0);
    const ft = X(f0);
    cap(q, hp[0], hp[1], kn[0], kn[1], r(7.4), r(5.8), f.pants);
    cap(q, kn[0], kn[1], ft[0], ft[1], r(5.6), r(4.3), f.pants);
    if (f.shinStripe) cap(q, kn[0] + fx * r(2), kn[1] + r(1), ft[0] + fx * r(1.4), ft[1] - r(1), r(0.9), r(0.9), [f.stripe, f.stripe, f.stripe, f.stripe]);
    const sx = ft[0] + fx * r(3);
    ell(q, sx, ft[1] + r(2), r(7.8), r(3.8), f.shoe);
    cap(q, ft[0], ft[1] - r(3), ft[0], ft[1] - r(1), r(4.5), r(4.8), f.shoe);
    R(q, f.sole, sx - r(7.6), ft[1] + r(4.8), r(15.4), Math.max(2, r(1.4)));
  };

  arm(pose.ba);
  leg(...pose.bl);
  // torso
  const ch = X(pose.chest);
  const wa = X(pose.waist);
  cap(q, ch[0], ch[1] + r(2), wa[0], wa[1] - r(3), r(11), r(8.6), f.top);
  ell(q, ch[0], ch[1] + r(1), r(11.5), r(6), f.top);
  const trim = [f.trim, f.trim, f.trim, f.trim];
  cap(q, ch[0] - fx * r(8), ch[1] + r(2), wa[0] - fx * r(6), wa[1] - r(4), r(1.1), r(1.1), trim);
  cap(q, ch[0] + fx * r(7), ch[1] + r(1), wa[0] + fx * r(5), wa[1] - r(4), r(0.9), r(0.9), trim);
  cap(q, wa[0] - r(9), wa[1] - r(2), wa[0] + r(9), wa[1] - r(1), r(2.8), r(2.8), f.belt);
  ell(q, wa[0] - fx * r(3), wa[1] - r(1), r(2.6), r(2.6), f.belt);
  cap(q, wa[0] - fx * r(3), wa[1], wa[0] - fx * r(8), wa[1] + r(7), r(1.8), r(1.2), f.belt);
  leg(...pose.fl);
  // head
  const hd = X(pose.head);
  cap(q, ch[0] + fx * r(1), ch[1] - r(4), hd[0], hd[1] + r(7), r(4), r(4), f.skin);
  ell(q, hd[0] - fx * r(7), hd[1] + r(1), r(2.2), r(3), f.skin);
  ell(q, hd[0], hd[1], r(8.4), r(9.4), f.skin);
  ell(q, hd[0] + fx * r(7.8), hd[1] + r(2), r(2), r(2.4), f.skin);
  if (f.hair) {
    if (f.hairCap) ell(q, hd[0] - fx * r(1.2), hd[1] - r(3.4), r(9.4), r(7.4), f.hair);
    for (const sp of f.spikes) {
      cap(q, hd[0] + fx * r(sp[0]), hd[1] + r(sp[1]), hd[0] + fx * r(sp[2]), hd[1] + r(sp[3]), r(sp[4]), r(0.6), f.hair);
    }
  }
  if (f.band) {
    cap(q, hd[0] - r(8.6), hd[1] - r(4.4), hd[0] + r(8.6), hd[1] - r(4.4), r(2), r(2), f.band);
    const t = pose.hurt ? -3 : 1;
    cap(q, hd[0] - fx * r(8), hd[1] - r(4.4), hd[0] - fx * r(17), hd[1] - r(2 + t * 2), r(1.4), r(0.8), f.band);
  }
  const ex = hd[0] + fx * r(4);
  const ey = hd[1] + r(0.8);
  const ex2 = hd[0] - fx * r(0.8);
  const black = ["#000", "#000", "#000", "#000"];
  if (f.visor && !pose.hurt) {
    cap(q, hd[0] - fx * r(2), ey, hd[0] + fx * r(8), ey, r(2.4), r(2.2), f.visor);
  } else if (pose.hurt) {
    for (const e of [ex, ex2]) {
      cap(q, e - r(1.6), ey - r(1.4), e + r(1.6), ey + r(1.4), r(0.5), r(0.5), black);
      cap(q, e - r(1.6), ey + r(1.4), e + r(1.6), ey - r(1.4), r(0.5), r(0.5), black);
    }
  } else {
    R(q, "#fff", ex - r(1.6), ey - r(1.6), r(3.4), r(3));
    R(q, f.eye, ex + (fx > 0 ? r(0.6) : -r(1.2)), ey - r(1.2), r(1.6), r(2.4));
    R(q, "#fff", ex2 - r(1.2), ey - r(1.2), r(2.4), r(2.4));
    R(q, f.eye, ex2 + (fx > 0 ? r(0.4) : -r(0.6)), ey - r(0.8), r(1.2), r(1.8));
    cap(q, ex - r(2.4), ey - r(3.4), ex + r(2.6), ey - r(2.6), r(0.7), r(0.7), black);
  }
  cap(q, hd[0] + fx * r(2), hd[1] + r(6.6), hd[0] + fx * r(6), hd[1] + r(pose.hurt ? 7.6 : 6.4), r(0.55), r(0.55), ["#400", "#400", "#600", "#600"]);
  arm(pose.fa);

  // 1 px outline around the whole figure
  const src = q.getImageData(0, 0, SPRITE_W, SPRITE_H);
  const d = src.data;
  const out = q.createImageData(SPRITE_W, SPRITE_H);
  const o = out.data;
  const oc = [parseInt(f.outline.slice(1, 3), 16), parseInt(f.outline.slice(3, 5), 16), parseInt(f.outline.slice(5, 7), 16)];
  const alpha = (i, j) => (i < 0 || j < 0 || i >= SPRITE_W || j >= SPRITE_H ? 0 : d[(j * SPRITE_W + i) * 4 + 3]);
  let bottom = 0;
  for (let j = 0; j < SPRITE_H; j++) {
    for (let i = 0; i < SPRITE_W; i++) {
      const k = (j * SPRITE_W + i) * 4;
      if (d[k + 3] > 0) {
        o[k] = d[k];
        o[k + 1] = d[k + 1];
        o[k + 2] = d[k + 2];
        o[k + 3] = 255;
        bottom = Math.max(bottom, j);
      } else if (alpha(i - 1, j) || alpha(i + 1, j) || alpha(i, j - 1) || alpha(i, j + 1)) {
        o[k] = oc[0];
        o[k + 1] = oc[1];
        o[k + 2] = oc[2];
        o[k + 3] = 255;
        bottom = Math.max(bottom, j + 1);
      }
    }
  }
  q.putImageData(out, 0, 0);
  canvas.bottom = bottom - oy; // how far below the pelvis the lowest pixel is
  return canvas;
}

// one cache per fighter: pose name + facing -> canvas
export function buildSprites(look) {
  const spec = specFromLook(look);
  const sprites = {};
  for (const [name, pose] of Object.entries(POSES)) {
    sprites[`${name}|0`] = drawFighter(spec, pose, false);
    sprites[`${name}|1`] = drawFighter(spec, pose, true);
  }
  return sprites;
}

// just the head and shoulders, for the lobby list
const headCache = new Map();
export function headshot(look) {
  const key = JSON.stringify(look);
  if (!headCache.has(key)) {
    const sprite = drawFighter(specFromLook(look), POSES.idle, false);
    const c = document.createElement("canvas");
    c.width = 40;
    c.height = 40;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(sprite, 92, 14, 64, 64, 0, 0, 40, 40);
    headCache.set(key, c);
  }
  return headCache.get(key);
}
