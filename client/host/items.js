import { KART_RADIUS, STUN_TIME } from "./physics.js";

// Item boxes, held items, bananas and rockets. All state lives on the Race; this file
// holds the rules. Items: boost (speed burst), banana (trap behind you), rocket (flies
// straight ahead and spins out the first kart it hits).
export const BOX_RESPAWN = 6; // s
const BOX_ROWS = 6;
const BOX_PICKUP_RADIUS = 2.4;
const BANANA_LIFE = 40; // s
const ROCKET_SPEED = 55; // m/s
const ROCKET_LIFE = 3; // s
const BOOST_TIME = 2; // s
const HIT_IMMUNITY = STUN_TIME + 1.2; // s after a hit during which nothing else can hit you

// 3 kart-wide boxes across the road, in 6 rows spread round the lap (never on the start line)
export function createItemBoxes(track) {
  const boxes = [];
  for (let r = 0; r < BOX_ROWS; r++) {
    const i = Math.round((track.n * (r + 0.5)) / BOX_ROWS) % track.n;
    const p = track.points[i];
    const t = track.tangent(i);
    for (const side of [-1, 0, 1]) {
      boxes.push({ x: p.x + t.z * side * 4.5, z: p.z - t.x * side * 4.5, cooldown: 0 });
    }
  }
  return boxes;
}

// Karts at the back get better items (more boosts and rockets, fewer bananas).
function rollItem(position, count) {
  const behind = count > 1 ? (position - 1) / (count - 1) : 0.5; // 0 = first, 1 = last
  const weights = {
    boost: 1.5 + 1.5 * behind,
    banana: 2.2 - 1.5 * behind,
    rocket: 0.2 + 2.3 * behind,
  };
  let roll = Math.random() * (weights.boost + weights.banana + weights.rocket);
  for (const [item, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll <= 0) return item;
  }
  return "boost";
}

function hitKart(race, k) {
  if (k.immune > 0 || k.finished) return false;
  k.stun = STUN_TIME;
  k.immune = HIT_IMMUNITY;
  k.drifting = false;
  race.events.push({ type: "hit", id: k.id });
  return true;
}

// called when a kart presses the item button while holding something
export function fireItem(race, k) {
  const fx = Math.sin(k.heading);
  const fz = Math.cos(k.heading);
  switch (k.item) {
    case "boost":
      k.boost = Math.max(k.boost, BOOST_TIME);
      break;
    case "banana":
      race.bananas.push({ x: k.x - fx * 3, z: k.z - fz * 3, owner: k.id, age: 0 });
      break;
    case "rocket":
      race.rockets.push({ x: k.x + fx * 2.5, z: k.z + fz * 2.5, heading: k.heading, owner: k.id, age: 0 });
      break;
  }
  race.events.push({ type: "use", id: k.id, item: k.item });
  k.item = null;
}

export function updateItems(race, dt) {
  const { karts, track } = race;

  // pick up boxes
  for (const box of race.itemBoxes) {
    if (box.cooldown > 0) {
      box.cooldown -= dt;
      continue;
    }
    for (const k of karts) {
      if (k.item || k.finished) continue;
      if (Math.hypot(k.x - box.x, k.z - box.z) < BOX_PICKUP_RADIUS) {
        k.item = rollItem(k.position, karts.length);
        k.itemAge = 0;
        box.cooldown = BOX_RESPAWN;
        race.events.push({ type: "pickup", id: k.id });
        break;
      }
    }
  }

  // bananas: whoever drives over one (the owner only after a moment) spins out
  race.bananas = race.bananas.filter((b) => {
    b.age += dt;
    if (b.age > BANANA_LIFE) return false;
    for (const k of karts) {
      if (k.id === b.owner && b.age < 1) continue;
      if (Math.hypot(k.x - b.x, k.z - b.z) < KART_RADIUS + 0.5 && hitKart(race, k)) return false;
    }
    return true;
  });

  // rockets: fly straight, vanish at the wall or when they hit someone
  race.rockets = race.rockets.filter((r) => {
    r.age += dt;
    r.x += Math.sin(r.heading) * ROCKET_SPEED * dt;
    r.z += Math.cos(r.heading) * ROCKET_SPEED * dt;
    if (r.age > ROCKET_LIFE || track.locate(r.x, r.z).dist > track.halfWidth) return false;
    for (const k of karts) {
      if (k.id === r.owner && r.age < 0.3) continue;
      if (Math.hypot(k.x - r.x, k.z - r.z) < KART_RADIUS + 0.8 && hitKart(race, k)) return false;
    }
    return true;
  });
}
