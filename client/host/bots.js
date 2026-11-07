// AI karts: steer towards a point ahead on the centreline, lift off before sharp bends,
// and use items when it makes sense. `skill` (0.85..1) scales how fast a bot dares to go.
const MAX_SPEED = 30;

function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function botInput(kart, track, karts) {
  const speed = Math.max(kart.speed, 0);
  const look = Math.round((14 + speed * 0.8) / track.spacing); // look further ahead when faster
  const target = track.points[(kart.idx + look) % track.n];
  const diff = wrap(Math.atan2(target.x - kart.x, target.z - kart.z) - kart.heading);

  // how much the road turns in the next stretch
  const t1 = track.tangent(kart.idx);
  const t2 = track.tangent((kart.idx + look * 2) % track.n);
  const bend = Math.abs(wrap(Math.atan2(t2.x, t2.z) - Math.atan2(t1.x, t1.z)));
  const cornerSpeed = bend > 0.5 ? 20 : MAX_SPEED;

  return {
    left: diff > 0.05,
    right: diff < -0.05,
    gas: speed < Math.min(cornerSpeed, MAX_SPEED * kart.skill),
    brake: (bend > 0.5 && speed > cornerSpeed + 2) || (Math.abs(diff) > 0.7 && speed > 12),
    item: wantsItem(kart, karts, bend),
  };
}

function wantsItem(kart, karts, bend) {
  if (!kart.item || kart.itemAge < 1.2) return false;
  if (kart.itemAge > 12) return true; // don't hold on to it forever
  if (kart.item === "boost") return bend < 0.3; // on a straight
  const fx = Math.sin(kart.heading);
  const fz = Math.cos(kart.heading);
  for (const o of karts) {
    if (o === kart || o.finished) continue;
    const dx = o.x - kart.x;
    const dz = o.z - kart.z;
    const ahead = dx * fx + dz * fz;
    const side = Math.abs(dx * fz - dz * fx);
    if (kart.item === "rocket" && ahead > 8 && ahead < 70 && side < 5) return true;
    if (kart.item === "banana" && ahead < -3 && ahead > -25 && side < 6) return true;
  }
  return false;
}
