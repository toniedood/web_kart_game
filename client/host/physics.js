// Simple arcade physics on a flat plane. Units: metres, seconds.
// A kart faces `heading` (forward = (sin h, cos h)) and has a velocity vector.
// Its forward speed is driven by the buttons; sideways speed is killed quickly (grip),
// so after a bump the kart slides for a moment and then straightens out.
export const KART_RADIUS = 1.3;
export const STUN_TIME = 1.3; // s spent spinning after a hit

const MAX_SPEED = 30; // m/s, about 108 km/h
const BOOST_SPEED = 42;
const MAX_REVERSE = 8;
const ACCEL = 16;
const BRAKE = 28;
const REVERSE_ACCEL = 10;
const DRAG = 0.35; // 1/s
const GRIP = 7; // 1/s
const DRIFT_GRIP = 2.2; // 1/s: much less grip, the kart slides
const TURN_RATE = 2.4; // rad/s at low speed
const WALL_BOUNCE = 0.35;
const KART_BOUNCE = 0.6;

const DRIFT_MIN_SPEED = 14; // m/s needed to start a drift
const DRIFT_SMALL = 0.8; // s of drifting for a small boost
const DRIFT_BIG = 1.6; // s of drifting for a big boost
const NO_INPUT = {};

// Drifting: hold brake while steering at speed. The kart turns harder and slides.
// Releasing brake after a while gives a boost.
function endDrift(k) {
  if (!k.drifting) return;
  k.drifting = false;
  if (k.driftCharge > DRIFT_BIG) {
    k.boost = Math.max(k.boost, 1.4);
    k.driftBoost = 2;
  } else if (k.driftCharge > DRIFT_SMALL) {
    k.boost = Math.max(k.boost, 0.8);
    k.driftBoost = 1;
  }
  k.driftCharge = 0;
}

export function stepKart(k, input, dt, track) {
  if (k.stun > 0) {
    k.stun -= dt;
    k.driftCharge = 0; // no boost for a drift that ended in a crash
    endDrift(k);
    input = NO_INPUT;
  }
  if (k.boost > 0) k.boost -= dt;
  const boosting = k.boost > 0;

  const fx = Math.sin(k.heading);
  const fz = Math.cos(k.heading);
  let vf = k.vx * fx + k.vz * fz; // forward speed
  let vs = k.vx * fz - k.vz * fx; // sideways speed

  // steering: left turns the nose to +heading
  const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  if (!k.drifting && input.brake && steer !== 0 && vf > DRIFT_MIN_SPEED) {
    k.drifting = true;
    k.driftDir = steer;
    k.driftCharge = 0;
    k.driftStarted = true;
  }
  if (k.drifting) {
    if (!input.brake || vf < DRIFT_MIN_SPEED * 0.7) endDrift(k);
    else k.driftCharge += dt;
  }

  const maxSpeed = boosting ? BOOST_SPEED : MAX_SPEED;
  if (input.gas || boosting) vf += ACCEL * (boosting ? 2.5 : 1) * (1 - Math.max(vf, 0) / maxSpeed) * dt;
  if (input.brake && !k.drifting) vf -= (vf > 0 ? BRAKE : REVERSE_ACCEL) * dt;
  vf = Math.max(vf, -MAX_REVERSE);
  vf -= vf * DRAG * dt;
  if (k.stun > 0) vf -= vf * 3 * dt;
  if (vf > maxSpeed) vf -= (vf - maxSpeed) * 2 * dt; // a boost fades out smoothly
  vs *= Math.exp(-(k.drifting ? DRIFT_GRIP : GRIP) * dt);

  // in a drift the kart keeps turning towards the drift side; steering adjusts the angle
  const turn = k.drifting ? Math.max(-1.4, Math.min(1.4, k.driftDir * 0.9 + steer * 0.5)) : steer;
  k.steer = Math.max(-1, Math.min(1, turn));
  const bite = Math.max(-1, Math.min(1, vf / 6)); // needs speed, flips when reversing
  k.heading += (turn * TURN_RATE * bite * dt) / (1 + Math.abs(vf) / 35);

  const nfx = Math.sin(k.heading);
  const nfz = Math.cos(k.heading);
  k.vx = nfx * vf + nfz * vs;
  k.vz = nfz * vf - nfx * vs;
  k.x += k.vx * dt;
  k.z += k.vz * dt;

  collideWall(k, track);
  k.speed = k.vx * nfx + k.vz * nfz;
}

// The road edge is a wall: push the kart back inside and bounce it off.
function collideWall(k, track) {
  const loc = track.locate(k.x, k.z, k.idx ?? -1);
  k.idx = loc.i;
  k.progress = loc.progress;

  const limit = track.halfWidth - KART_RADIUS;
  if (loc.dist <= limit) return;

  const nx = (loc.px - k.x) / loc.dist; // points from the kart to the road centre
  const nz = (loc.pz - k.z) / loc.dist;
  k.x = loc.px - nx * limit;
  k.z = loc.pz - nz * limit;

  const outward = -(k.vx * nx + k.vz * nz);
  if (outward > 0) {
    k.hit = Math.max(k.hit ?? 0, outward); // impact strength, read by the race for sounds
    k.vx += nx * (1 + WALL_BOUNCE) * outward;
    k.vz += nz * (1 + WALL_BOUNCE) * outward;
    k.vx *= 0.98;
    k.vz *= 0.98;
  }
}

// Karts are circles of equal mass: push them apart and bounce along the contact normal.
export function collideKarts(karts) {
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i];
      const b = karts[j];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      let d = Math.hypot(dx, dz);
      const min = 2 * KART_RADIUS;
      if (d >= min) continue;
      if (d < 1e-6) {
        dx = 1;
        dz = 0;
        d = 1;
      }
      const nx = dx / d;
      const nz = dz / d;
      const push = (min - d) / 2;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;

      const approach = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (approach < 0) {
        a.hit = Math.max(a.hit ?? 0, -approach);
        b.hit = Math.max(b.hit ?? 0, -approach);
        const j2 = (-(1 + KART_BOUNCE) * approach) / 2;
        a.vx -= nx * j2;
        a.vz -= nz * j2;
        b.vx += nx * j2;
        b.vz += nz * j2;
      }
    }
  }
}
