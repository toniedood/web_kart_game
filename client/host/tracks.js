// Track definitions. `points` is a closed loop of [x, z] in metres; point 0 is the
// start/finish line and the cars drive from point 0 towards point 1.
// `theme` colours the scenery.

// A wobbly ring: x/z follow an ellipse with a few bumps, giving flowing corners.
function snowRing() {
  const points = [];
  const count = 18;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i / count) * Math.PI * 2;
    points.push([
      (200 + 28 * Math.sin(3 * a)) * Math.cos(a),
      (130 + 22 * Math.sin(2 * a + 1)) * Math.sin(a),
    ]);
  }
  return points;
}

export const TRACKS = [
  {
    name: "Green Valley",
    points: [
      [0, -100], [70, -100], [125, -70], [140, -10], [110, 40], [55, 45],
      [25, 85], [-35, 110], [-100, 85], [-125, 20], [-100, -45], [-55, -90],
    ],
    theme: { ground: 0x4a9c4a, crown: 0x1f6b2a, trunk: 0x6b4423 },
  },
  {
    name: "Desert Run",
    points: [
      [0, -120], [80, -120], [160, -100], [200, -50], [190, 10], [140, 40],
      [95, 30], [70, 75], [85, 125], [40, 165], [-40, 165], [-75, 115],
      [-65, 55], [-115, 25], [-170, 45], [-205, 0], [-190, -65], [-130, -105], [-60, -125],
    ],
    theme: { ground: 0xd9b36a, crown: 0x6f8f3a, trunk: 0x8a5a2b },
  },
  {
    name: "Snow Ring",
    points: snowRing(),
    theme: { ground: 0xeef4f8, crown: 0x2d6a4f, trunk: 0x5a3d2b },
  },
];
