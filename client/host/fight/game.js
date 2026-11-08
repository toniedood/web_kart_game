// Neon Brawl rules. Pure logic, no drawing: the view reads this state.
// Units are pixels on a 640x360 stage; `h` is the height above the floor.
export const STAGE = { W: 640, H: 360, floorY: 286, minX: 52, maxX: 588 };

const WALK = 110;
const JUMP_SPEED = 360;
const GRAVITY = 1100;
const MAX_HP = 100;
const ROUND_TIME = 60;
const ROUNDS_TO_WIN = 2;
const INTRO_TIME = 2.4;
const END_TIME = 2.8;

const ATTACKS = {
  punch: { startup: 0.07, active: 0.12, total: 0.32, reach: 52, damage: 7, knock: 170, stun: 0.3 },
  kick: { startup: 0.04, active: 0.2, total: 0.4, reach: 62, damage: 10, knock: 230, stun: 0.36 },
};

export class FightGame {
  // players: [{ id, name, color, bot?, skill? }]
  constructor(players) {
    this.fighters = players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      look: p.look,
      bot: !!p.bot,
      skill: p.skill ?? 1,
      index: i,
      wins: 0,
      connected: true,
      prev: {},
      botBlock: 0,
    }));
    this.round = 0;
    this.events = [];
    this.winner = null; // fighter who won the last round
    this.matchWinner = null;
    this.startRound();
  }

  startRound() {
    this.round += 1;
    this.phase = "intro";
    this.phaseTime = INTRO_TIME;
    this.timeLeft = ROUND_TIME;
    this.winner = null;
    const n = this.fighters.length;
    const spots = n === 2 ? [190, 450] : n === 3 ? [140, 320, 500] : [110, 255, 385, 530];
    this.fighters.forEach((f, i) => {
      Object.assign(f, {
        x: spots[i],
        h: 0,
        vy: 0,
        vx: 0,
        facing: spots[i] < 320 ? 1 : -1,
        hp: MAX_HP,
        alive: true,
        state: "idle",
        stun: 0,
        atk: null,
        atkTime: 0,
        hitSet: null,
        airKick: false,
        cooldown: 0,
        blocking: false,
        walking: false,
      });
    });
    this.events.push({ type: "round", round: this.round });
  }

  get ranked() {
    return [...this.fighters].sort((a, b) => b.wins - a.wins || b.hp - a.hp);
  }

  update(dt, getInput) {
    this.phaseTime -= dt;
    if (this.phase === "intro") {
      this.simulate(dt, () => ({}), false);
      if (this.phaseTime <= 0) {
        this.phase = "fight";
        this.events.push({ type: "go" });
      }
    } else if (this.phase === "fight") {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      this.simulate(dt, getInput, true);
      this.checkRoundEnd();
    } else if (this.phase === "roundend") {
      this.simulate(dt, () => ({}), false);
      if (this.phaseTime <= 0) {
        if (this.matchWinner) {
          this.phase = "results";
        } else {
          this.startRound();
        }
      }
    }
  }

  checkRoundEnd() {
    const alive = this.fighters.filter((f) => f.alive);
    if (alive.length > 1 && this.timeLeft > 0) return;
    let winner = null;
    if (alive.length === 1) winner = alive[0];
    else if (alive.length > 1) {
      // time is up: the healthiest fighter wins, a tie is a draw
      const best = Math.max(...alive.map((f) => f.hp));
      const top = alive.filter((f) => f.hp === best);
      if (top.length === 1) winner = top[0];
    }
    this.winner = winner;
    if (winner) {
      winner.wins += 1;
      if (winner.wins >= ROUNDS_TO_WIN) this.matchWinner = winner;
    }
    this.phase = "roundend";
    this.phaseTime = END_TIME;
    this.events.push({ type: "roundend", id: winner?.id ?? null, match: !!this.matchWinner });
  }

  simulate(dt, getInput, canAct) {
    for (const f of this.fighters) {
      const input = canAct && f.alive && f.connected ? (f.bot ? this.botInput(f, dt) : getInput(f)) ?? {} : {};
      this.step(f, input, dt);
    }
    this.separate();
    for (const f of this.fighters) this.resolveAttack(f);
  }

  nearestFoe(f) {
    let best = null;
    for (const g of this.fighters) {
      if (g === f || !g.alive) continue;
      if (!best || Math.abs(g.x - f.x) < Math.abs(best.x - f.x)) best = g;
    }
    return best;
  }

  step(f, input, dt) {
    const prev = f.prev;
    const grounded = f.h <= 0 && f.vy <= 0;
    f.cooldown = Math.max(0, f.cooldown - dt);
    f.walking = false;

    // vertical motion (everyone, also when stunned or KO)
    if (!grounded) {
      f.h += f.vy * dt;
      f.vy -= GRAVITY * dt;
      if (f.h <= 0) {
        f.h = 0;
        f.vy = 0;
        f.airKick = false;
        if (f.atk === "kick") f.atk = null;
      }
    }
    f.x += f.vx * dt;
    f.vx *= Math.max(0, 1 - 7 * dt);
    if (Math.abs(f.vx) < 4) f.vx = 0;

    if (!f.alive) {
      f.state = "ko";
    } else if (f.stun > 0) {
      f.stun -= dt;
      f.state = "hit";
      f.atk = null;
    } else {
      const onFloor = f.h <= 0;
      const foe = this.nearestFoe(f);
      if (foe && onFloor && !f.atk) f.facing = foe.x >= f.x ? 1 : -1;

      f.blocking = onFloor && !f.atk && !!(input.item || input.down);
      if (f.atk) {
        f.atkTime += dt;
        if (f.atkTime >= ATTACKS[f.atk].total) f.atk = null;
      }
      if (f.atk) {
        f.state = f.atk;
      } else if (f.blocking) {
        f.state = "block";
      } else {
        const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        if (onFloor) f.x += dir * WALK * dt;
        else f.x += dir * WALK * 0.7 * dt;
        f.walking = dir !== 0 && onFloor;
        const wantJump = (input.brake && !prev.brake) || (input.up && !prev.up);
        if (wantJump && onFloor) {
          f.vy = JUMP_SPEED;
          f.h = 0.01;
          this.events.push({ type: "jump", id: f.id });
        }
        const wantHit = input.gas && !prev.gas && f.cooldown <= 0;
        if (wantHit) {
          if (onFloor) this.startAttack(f, "punch");
          else if (!f.airKick) {
            f.airKick = true;
            this.startAttack(f, "kick");
          }
        }
        f.state = f.atk ?? (!onFloor ? "jump" : f.walking ? "walk" : "idle");
      }
    }
    f.x = Math.max(STAGE.minX, Math.min(STAGE.maxX, f.x));
    f.prev = { gas: !!input.gas, brake: !!input.brake, up: !!input.up };
  }

  startAttack(f, kind) {
    f.atk = kind;
    f.atkTime = 0;
    f.hitSet = new Set();
    f.cooldown = ATTACKS[kind].total + 0.05;
    this.events.push({ type: "swing", id: f.id, kind });
  }

  // fighters on the floor push each other apart
  separate() {
    const list = this.fighters.filter((f) => f.alive && f.h < 8);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const gap = 34 - Math.abs(a.x - b.x);
        if (gap > 0) {
          const dir = a.x <= b.x ? -1 : 1;
          a.x += (dir * gap) / 2;
          b.x -= (dir * gap) / 2;
        }
      }
    }
    for (const f of this.fighters) f.x = Math.max(STAGE.minX, Math.min(STAGE.maxX, f.x));
  }

  resolveAttack(f) {
    if (!f.atk || !f.alive) return;
    const a = ATTACKS[f.atk];
    if (f.atkTime < a.startup || f.atkTime > a.startup + a.active) return;
    for (const g of this.fighters) {
      if (g === f || !g.alive || f.hitSet.has(g.id)) continue;
      const dx = (g.x - f.x) * f.facing;
      if (dx < -10 || dx > a.reach) continue;
      if (Math.abs(g.h - f.h) > 58) continue;
      f.hitSet.add(g.id);
      const blocked = g.blocking && g.stun <= 0;
      const dmg = blocked ? Math.ceil(a.damage * 0.15) : a.damage;
      g.hp = Math.max(0, g.hp - dmg);
      g.vx = f.facing * (blocked ? a.knock * 0.35 : a.knock);
      const at = { x: (f.x + g.x) / 2 + f.facing * 6, h: Math.max(f.h, g.h) + 26 };
      if (blocked) {
        this.events.push({ type: "block", id: g.id, ...at });
      } else {
        g.stun = a.stun;
        g.atk = null;
        g.state = "hit";
        if (g.h > 0) g.vy = Math.max(g.vy, 120);
        this.events.push({ type: "hurt", id: g.id, by: f.id, ...at });
      }
      if (g.hp <= 0) {
        g.alive = false;
        g.state = "ko";
        g.atk = null;
        g.vy = 220;
        g.h = Math.max(g.h, 0.01);
        g.vx = f.facing * 260;
        this.events.push({ type: "ko", id: g.id, ...at });
      }
    }
  }

  // very small AI: walk to the nearest foe, punch when close, sometimes block or jump
  botInput(f, dt) {
    const foe = this.nearestFoe(f);
    if (!foe) return {};
    const input = {};
    const dx = foe.x - f.x;
    const dist = Math.abs(dx);
    f.botBlock = Math.max(0, f.botBlock - dt);
    if (foe.atk && dist < 80 && f.botBlock <= 0 && Math.random() < 0.05 * f.skill) f.botBlock = 0.35;
    if (f.botBlock > 0) {
      input.item = true;
      return input;
    }
    if (dist > 46) {
      if (dx > 0) input.right = true;
      else input.left = true;
    } else if (dist < 26 && Math.random() < 0.02) {
      if (dx > 0) input.left = true;
      else input.right = true;
    }
    if (dist < 60 && Math.random() < 3.2 * dt * f.skill) input.gas = true;
    if (dist > 70 && dist < 140 && Math.random() < 0.6 * dt) {
      input.brake = true;
      if (Math.random() < 0.6) input.gas = true;
    }
    if (f.h > 0 && dist < 70 && Math.random() < 6 * dt * f.skill) input.gas = true;
    return input;
  }
}
