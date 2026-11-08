// Hell Keep rules: a first-person deathmatch on a grid map. Pure logic, no drawing.
// The angle grows when you turn right. x goes right, y goes down, one map cell = 1 unit.
export const MAP = [
  "111111111111111111111111",
  "100000000400004000000001",
  "100000000400004000000001",
  "100000000000000000000001",
  "100022000000000000220001",
  "100022000033330000220001",
  "100000000030030000000001",
  "100000000000000000000001",
  "111000000000000000000111",
  "100000000000000000000001",
  "100000033000000330000001",
  "100000030000000030000001",
  "100000030000000030000001",
  "100000033000000330000001",
  "100000000000000000000001",
  "111000000000000000000111",
  "100000000000000000000001",
  "100000000030030000000001",
  "100022000033330000220001",
  "100022000000000000220001",
  "100000000000000000000001",
  "100000000400004000000001",
  "100000000400004000000001",
  "111111111111111111111111",
].map((row) => [...row].map(Number));

export const MAP_W = MAP[0].length;
export const MAP_H = MAP.length;

const SPAWNS = [[2.5, 2.5], [21.5, 2.5], [2.5, 21.5], [21.5, 21.5], [12.5, 3.5], [12.5, 20.5], [2.5, 12.5], [21.5, 12.5]];
const ITEM_SPOTS = [
  ["ammo", 7.5, 7.5], ["ammo", 16.5, 16.5], ["ammo", 3.5, 9.5], ["ammo", 20.5, 14.5], ["ammo", 8.5, 3.5], ["ammo", 15.5, 20.5],
  ["health", 12.5, 12.5], ["health", 3.5, 14.5], ["health", 20.5, 9.5], ["health", 12.5, 8.0], ["health", 12.5, 16.0],
];
export const BARRELS = [[10.5, 10.0], [13.5, 14.0], [6.0, 18.5], [16.5, 5.5]];

const FRAG_LIMIT = 10;
const MATCH_TIME = 180;
const INTRO_TIME = 3;
const RADIUS = 0.28;
const MOVE = 3.4;
const STRAFE = 2.8;
const TURN = 2.5;
const RESPAWN = 3;
const WEAPONS = [
  { name: "SHOTGUN", cooldown: 0.85, pellets: 7, spread: 0.075, damage: 10, range: 18 },
  { name: "PISTOL", cooldown: 0.34, pellets: 1, spread: 0.012, damage: 15, range: 24 },
];

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const solid = (x, y) => {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  return cx < 0 || cy < 0 || cx >= MAP_W || cy >= MAP_H || MAP[cy][cx] > 0;
};

// distance from (x, y) along (dx, dy) to the first wall
export function castWall(x, y, dx, dy, max = 40) {
  let mx = Math.floor(x);
  let my = Math.floor(y);
  const ddx = Math.abs(1 / (dx || 1e-9));
  const ddy = Math.abs(1 / (dy || 1e-9));
  let sx;
  let sy;
  let sdx;
  let sdy;
  if (dx < 0) {
    sx = -1;
    sdx = (x - mx) * ddx;
  } else {
    sx = 1;
    sdx = (mx + 1 - x) * ddx;
  }
  if (dy < 0) {
    sy = -1;
    sdy = (y - my) * ddy;
  } else {
    sy = 1;
    sdy = (my + 1 - y) * ddy;
  }
  let dist = 0;
  while (dist < max) {
    if (sdx < sdy) {
      dist = sdx;
      sdx += ddx;
      mx += sx;
    } else {
      dist = sdy;
      sdy += ddy;
      my += sy;
    }
    if (solid(mx, my)) return dist;
  }
  return max;
}

export class ShooterGame {
  // players: [{ id, name, color, look, bot?, skill? }]
  constructor(players) {
    const spawns = [...SPAWNS].sort(() => Math.random() - 0.5);
    this.players = players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      look: p.look,
      bot: !!p.bot,
      skill: p.skill ?? 0.8,
      index: i,
      connected: true,
      frags: 0,
      deaths: 0,
      weapon: 0,
      prev: {},
      botState: { target: null, reaction: 0, strafe: 0, strafeTime: 0, stuck: 0, last: [0, 0] },
      ...this.spawnState(spawns[i % spawns.length]),
    }));
    this.pickups = ITEM_SPOTS.map(([kind, x, y]) => ({ kind, x, y, cooldown: 0 }));
    this.barrels = BARRELS.map(([x, y]) => ({ x, y }));
    this.feed = []; // { text, time }
    this.events = [];
    this.phase = "intro";
    this.phaseTime = INTRO_TIME;
    this.timeLeft = MATCH_TIME;
    this.time = 0;
    this.winner = null;
  }

  spawnState([x, y]) {
    return {
      x,
      y,
      angle: Math.atan2(12 - y, 12 - x), // look at the middle of the map
      hp: 100,
      ammo: 12,
      alive: true,
      respawn: 0,
      invuln: 1.5,
      cooldown: 0,
      flash: 0,
      hurt: 0,
      hitMark: 0,
      bob: 0,
      moving: false,
    };
  }

  get ranked() {
    return [...this.players].sort((a, b) => b.frags - a.frags || a.deaths - b.deaths);
  }

  update(dt, getInput) {
    this.time += dt;
    this.feed = this.feed.filter((f) => this.time - f.time < 5);
    if (this.phase === "intro") {
      this.phaseTime -= dt;
      for (const p of this.players) this.tick(p, {}, dt, false);
      if (this.phaseTime <= 0) {
        this.phase = "play";
        this.events.push({ type: "go" });
      }
      return;
    }
    if (this.phase === "results") return;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    for (const p of this.players) {
      const input = p.bot ? this.botInput(p, dt) : p.connected ? getInput(p) ?? {} : {};
      this.tick(p, input, dt, true);
    }
    this.separate();
    for (const pk of this.pickups) {
      pk.cooldown = Math.max(0, pk.cooldown - dt);
      if (pk.cooldown > 0) continue;
      for (const p of this.players) {
        if (!p.alive || Math.hypot(p.x - pk.x, p.y - pk.y) > 0.6) continue;
        if (pk.kind === "ammo" && p.ammo < 40) p.ammo = Math.min(40, p.ammo + 6);
        else if (pk.kind === "health" && p.hp < 100) p.hp = Math.min(100, p.hp + 30);
        else continue;
        pk.cooldown = 15;
        this.events.push({ type: "pickup", id: p.id });
        break;
      }
    }
    const leader = this.ranked[0];
    if (leader.frags >= FRAG_LIMIT || this.timeLeft <= 0) {
      this.phase = "results";
      this.winner = leader;
      this.events.push({ type: "roundend", id: leader.id, match: true });
    }
  }

  tick(p, input, dt, canAct) {
    p.cooldown = Math.max(0, p.cooldown - dt);
    p.flash = Math.max(0, p.flash - dt);
    p.hurt = Math.max(0, p.hurt - dt);
    p.hitMark = Math.max(0, p.hitMark - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    if (!p.alive) {
      if (canAct) {
        p.respawn -= dt;
        if (p.respawn <= 0) this.respawn(p);
      }
      return;
    }
    if (!canAct) return;
    const strafing = !!input.brake;
    const side = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const forward = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    if (!strafing) p.angle = wrap(p.angle + side * TURN * dt);
    const vx = Math.cos(p.angle) * forward * MOVE + (strafing ? Math.cos(p.angle + Math.PI / 2) * side * STRAFE : 0);
    const vy = Math.sin(p.angle) * forward * MOVE + (strafing ? Math.sin(p.angle + Math.PI / 2) * side * STRAFE : 0);
    this.move(p, vx * dt, vy * dt);
    p.moving = vx !== 0 || vy !== 0;
    if (p.moving) p.bob += dt * 9;
    if (input.item && !p.prev.item) {
      p.weapon = 1 - p.weapon;
      this.events.push({ type: "switch", id: p.id });
    }
    if (input.gas && p.cooldown <= 0) this.fire(p);
    p.prev = { item: !!input.item };
  }

  move(p, dx, dy) {
    const free = (x, y) => !(solid(x - RADIUS, y - RADIUS) || solid(x + RADIUS, y - RADIUS) || solid(x - RADIUS, y + RADIUS) || solid(x + RADIUS, y + RADIUS));
    if (free(p.x + dx, p.y)) p.x += dx;
    if (free(p.x, p.y + dy)) p.y += dy;
    // barrels are solid too
    for (const b of this.barrels) {
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < 0.5 && d > 0) {
        p.x = b.x + ((p.x - b.x) / d) * 0.5;
        p.y = b.y + ((p.y - b.y) / d) * 0.5;
      }
    }
  }

  separate() {
    const alive = this.players.filter((p) => p.alive);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 0.6 && d > 0) {
          const push = (0.6 - d) / 2;
          this.move(a, ((a.x - b.x) / d) * push, ((a.y - b.y) / d) * push);
          this.move(b, ((b.x - a.x) / d) * push, ((b.y - a.y) / d) * push);
        }
      }
    }
  }

  fire(p) {
    const w = WEAPONS[p.weapon];
    if (p.weapon === 0) {
      if (p.ammo <= 0) {
        p.weapon = 1; // out of shells: switch to the pistol
        return;
      }
      p.ammo -= 1;
    }
    p.cooldown = w.cooldown;
    p.flash = 0.12;
    this.events.push({ type: "shot", id: p.id, weapon: p.weapon });
    const jitter = p.bot ? (1 - p.skill) * 0.1 : 0;
    const damage = new Map();
    for (let i = 0; i < w.pellets; i++) {
      const a = p.angle + (Math.random() - 0.5) * 2 * (w.spread + jitter);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const wall = Math.min(castWall(p.x, p.y, dx, dy), w.range);
      let best = null;
      let bestT = wall;
      for (const q of this.players) {
        if (q === p || !q.alive || q.invuln > 0) continue;
        const rx = q.x - p.x;
        const ry = q.y - p.y;
        const t = rx * dx + ry * dy;
        if (t <= 0 || t >= bestT) continue;
        if (rx * rx + ry * ry - t * t <= 0.3 * 0.3) {
          best = q;
          bestT = t;
        }
      }
      if (best) {
        const falloff = Math.max(0.35, 1 - bestT / 16);
        damage.set(best, (damage.get(best) ?? 0) + w.damage * falloff);
        if (i === 0 || w.pellets === 1) this.events.push({ type: "puff", x: best.x, y: best.y, kind: "blood" });
      } else if (i < 2) {
        this.events.push({ type: "puff", x: p.x + dx * wall, y: p.y + dy * wall, kind: "dust" });
      }
    }
    for (const [q, dmg] of damage) this.damage(q, Math.round(dmg), p);
  }

  damage(q, amount, by) {
    q.hp -= amount;
    q.hurt = 0.35;
    by.hitMark = 0.2;
    this.events.push({ type: "hurt", id: q.id, by: by.id });
    if (q.hp > 0) return;
    q.alive = false;
    q.hp = 0;
    q.deaths += 1;
    q.respawn = RESPAWN;
    by.frags += 1;
    this.feed.push({ text: `${by.name} > ${q.name}`, time: this.time });
    this.events.push({ type: "ko", id: q.id, by: by.id });
  }

  respawn(p) {
    // the spawn point furthest from everyone else
    let best = SPAWNS[0];
    let bestD = -1;
    for (const s of SPAWNS) {
      const d = Math.min(...this.players.filter((o) => o !== p && o.alive).map((o) => Math.hypot(o.x - s[0], o.y - s[1])), 99);
      if (d > bestD) {
        bestD = d;
        best = s;
      }
    }
    Object.assign(p, this.spawnState(best), { weapon: 0 });
    this.events.push({ type: "respawn", id: p.id });
  }

  // a simple opponent: look for someone it can see, aim, shoot; otherwise wander
  botInput(b, dt) {
    const st = b.botState;
    const input = {};
    if (!b.alive) return input;
    let foe = null;
    let foeDist = 14;
    for (const q of this.players) {
      if (q === b || !q.alive) continue;
      const d = Math.hypot(q.x - b.x, q.y - b.y);
      if (d < foeDist && castWall(b.x, b.y, (q.x - b.x) / d, (q.y - b.y) / d) > d) {
        foe = q;
        foeDist = d;
      }
    }
    st.reaction = Math.max(0, st.reaction - dt);
    st.strafeTime -= dt;
    if (st.strafeTime <= 0) {
      st.strafeTime = 0.6 + Math.random();
      st.strafe = Math.random() < 0.5 ? -1 : 1;
    }
    let want;
    if (foe) {
      if (st.target !== foe) {
        st.target = foe;
        st.reaction = 0.5 / b.skill;
      }
      want = Math.atan2(foe.y - b.y, foe.x - b.x);
    } else {
      st.target = null;
      if (!st.goal || Math.hypot(st.goal[0] - b.x, st.goal[1] - b.y) < 1 || st.stuck > 0.6) {
        st.goal = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
        st.stuck = 0;
      }
      want = Math.atan2(st.goal[1] - b.y, st.goal[0] - b.x);
    }
    const diff = wrap(want - b.angle);
    if (Math.abs(diff) > 0.04) {
      if (diff > 0) input.right = true;
      else input.left = true;
    }
    if (foe) {
      if (foeDist > 5) input.up = true;
      else if (foeDist < 2.5) input.down = true;
      if (Math.abs(diff) < 0.5 && Math.random() < 0.7) {
        input.brake = true; // sidestep while fighting
        if (st.strafe > 0) {
          input.right = true;
          input.left = false;
        } else {
          input.left = true;
          input.right = false;
        }
      }
      if (Math.abs(diff) < 0.1 && st.reaction <= 0 && (b.weapon === 1 || b.ammo > 0 || foeDist > 8)) input.gas = true;
      if (b.weapon === 0 && b.ammo <= 0) input.item = !b.prev.item;
    } else if (Math.abs(diff) < 0.6) {
      input.up = true;
    }
    // stuck against a wall: turn away
    const moved = Math.hypot(b.x - st.last[0], b.y - st.last[1]);
    st.stuck = input.up && moved < 0.002 ? st.stuck + dt : Math.max(0, st.stuck - dt);
    st.last = [b.x, b.y];
    if (st.stuck > 0.25 && !foe) input.right = true;
    return input;
  }
}
