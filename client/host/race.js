import { stepKart, collideKarts } from "./physics.js";
import { createItemBoxes, fireItem, updateItems } from "./items.js";
import { COUNTDOWN_SECONDS, FINISH_TIMEOUT } from "./config.js";

// Race rules: countdown, laps, positions, items, finishing.
// Lap counting uses the progress along the centreline (0..n). Crossing the start line
// forwards is a jump from the end of the range to the start. Karts begin just behind the
// line with lapCount 0; crossing it makes lapCount 1 (= racing lap 1).
export class Race {
  // players: [{ id, name, color, bot?, skill? }]
  constructor(players, track, laps) {
    this.track = track;
    this.laps = laps;
    this.phase = "countdown"; // countdown -> race -> results
    this.countdown = COUNTDOWN_SECONDS;
    this.time = 0; // seconds since GO
    this.firstFinishTime = null;
    // things that happened, for sound/feedback: count, go, lap, finish, bump, pickup, use,
    // hit, drift, driftboost. Drained by main.js
    this.events = [{ type: "count", n: COUNTDOWN_SECONDS }];
    this.itemBoxes = createItemBoxes(track);
    this.bananas = [];
    this.rockets = [];
    this.karts = players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      look: p.look,
      bot: !!p.bot,
      skill: p.skill ?? 1,
      ...track.gridPose(i),
      vx: 0,
      vz: 0,
      speed: 0,
      lapCount: 0,
      lap: 1,
      position: i + 1,
      finished: false,
      finishTime: null,
      connected: true,
      steer: 0,
      hit: 0,
      item: null,
      itemAge: 0,
      itemPrev: false, // item button state last tick, to react to a press only once
      boost: 0,
      stun: 0,
      immune: 0,
      drifting: false,
      driftDir: 0,
      driftCharge: 0,
      driftBoost: 0,
      driftStarted: false,
    }));
    for (const k of this.karts) {
      const loc = track.locate(k.x, k.z);
      k.idx = loc.i;
      k.progress = loc.progress;
      k.prevProgress = loc.progress;
    }
    this.ranked = this.karts.slice();
  }

  update(dt, getInput) {
    if (this.phase === "results") return;
    if (this.phase === "countdown") {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (this.countdown <= 0) {
        this.phase = "race";
        this.events.push({ type: "go" });
      } else if (after !== before) {
        this.events.push({ type: "count", n: after });
      }
      return;
    }

    this.time += dt;
    for (const k of this.karts) {
      const input = k.finished ? { brake: k.speed > 1 } : getInput(k);
      const pressed = !!input.item;
      if (pressed && !k.itemPrev && k.item && k.stun <= 0 && !k.finished) fireItem(this, k);
      k.itemPrev = pressed;
      k.itemAge += dt;
      if (k.immune > 0) k.immune -= dt;

      stepKart(k, input, dt, this.track);
      if (k.driftStarted) this.events.push({ type: "drift", id: k.id });
      if (k.driftBoost) this.events.push({ type: "driftboost", id: k.id, level: k.driftBoost });
      k.driftStarted = false;
      k.driftBoost = 0;
      this.updateLaps(k);
    }
    collideKarts(this.karts);
    updateItems(this, dt);
    for (const k of this.karts) {
      if (k.hit > 3) this.events.push({ type: "bump", id: k.id, strength: k.hit });
      k.hit = 0;
    }
    this.rank();
    this.checkEnd();
  }

  updateLaps(k) {
    const n = this.track.n;
    if (k.prevProgress > 0.75 * n && k.progress < 0.25 * n) {
      k.lapCount++;
      if (k.lapCount >= 2 && k.lapCount <= this.laps) this.events.push({ type: "lap", id: k.id });
    } else if (k.prevProgress < 0.25 * n && k.progress > 0.75 * n && k.lapCount > 0) k.lapCount--;
    k.prevProgress = k.progress;

    k.lap = Math.min(Math.max(k.lapCount, 1), this.laps);
    if (!k.finished && k.lapCount > this.laps) {
      k.finished = true;
      k.finishTime = this.time;
      this.events.push({ type: "finish", id: k.id });
      if (this.firstFinishTime === null) this.firstFinishTime = this.time;
    }
  }

  rank() {
    const n = this.track.n;
    const score = (k) => (k.finished ? 1e9 - k.finishTime : k.lapCount * n + k.progress);
    this.ranked = this.karts.slice().sort((a, b) => score(b) - score(a));
    this.ranked.forEach((k, i) => (k.position = i + 1));
  }

  checkEnd() {
    const allDone = this.karts.every((k) => k.finished || !k.connected);
    const timedOut =
      this.firstFinishTime !== null && this.time - this.firstFinishTime > FINISH_TIMEOUT;
    if (allDone || timedOut) this.phase = "results";
  }
}
