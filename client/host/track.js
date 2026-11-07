import * as THREE from "three";

// Flat track: a closed smooth curve (the centreline) with a constant half width.
// Everything (walls, laps, positions) is derived from the distance to that curve.
export const TRACK_HALF_WIDTH = 8; // m, so the road is 16 m wide
const SAMPLE_SPACING = 1.9; // m between centreline samples
const SEARCH_WINDOW = 15; // segments searched around the last known position

export function buildTrack(def) {
  const curve = new THREE.CatmullRomCurve3(
    def.points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    "centripetal",
  );
  const samples = Math.round(curve.getLength() / SAMPLE_SPACING);
  const points = curve.getSpacedPoints(samples).slice(0, samples);
  const n = points.length;

  let length = 0;
  for (let i = 0; i < n; i++) length += points[i].distanceTo(points[(i + 1) % n]);
  const spacing = length / n;

  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  const bounds = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };

  // unit direction of travel at sample i
  function tangent(i) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    return { x: dx / len, z: dz / len };
  }

  // Closest point on the centreline. With a hint only nearby segments are checked,
  // which also stops a kart from "jumping" to a different part of the track.
  function locate(x, z, hint = -1) {
    let bi = 0;
    let bt = 0;
    let bd2 = Infinity;
    let bpx = 0;
    let bpz = 0;
    const test = (i) => {
      const a = points[i];
      const b = points[(i + 1) % n];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      let t = ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz);
      t = Math.max(0, Math.min(1, t));
      const px = a.x + abx * t;
      const pz = a.z + abz * t;
      const d2 = (x - px) ** 2 + (z - pz) ** 2;
      if (d2 < bd2) {
        bd2 = d2;
        bi = i;
        bt = t;
        bpx = px;
        bpz = pz;
      }
    };
    if (hint < 0) {
      for (let i = 0; i < n; i++) test(i);
    } else {
      for (let k = -SEARCH_WINDOW; k <= SEARCH_WINDOW; k++) test((hint + k + n) % n);
    }
    return { i: bi, progress: bi + bt, px: bpx, pz: bpz, dist: Math.sqrt(bd2) };
  }

  // Starting grid: two columns behind the line, 6 m between rows.
  function gridPose(slot) {
    const row = Math.floor(slot / 2);
    const side = slot % 2 === 0 ? 1 : -1;
    const i = (n - Math.round((6 + row * 6) / spacing) + n) % n;
    const t = tangent(i);
    const offset = side * TRACK_HALF_WIDTH * 0.4;
    return {
      x: points[i].x + t.z * offset,
      z: points[i].z - t.x * offset,
      heading: Math.atan2(t.x, t.z),
    };
  }

  return {
    name: def.name,
    theme: def.theme,
    curve,
    points,
    n,
    length,
    spacing,
    bounds,
    halfWidth: TRACK_HALF_WIDTH,
    tangent,
    locate,
    gridPose,
  };
}
