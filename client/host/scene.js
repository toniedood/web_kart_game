import * as THREE from "three";
import { STUN_TIME } from "./physics.js";

const HORIZON = 0xa4d0fc;

// The 3D view is drawn small and scaled up with hard pixels. Bigger number = chunkier pixels.
const PIXEL_ROWS = Number(new URLSearchParams(location.search).get("rows")) || 360; // internal height of the whole screen, in pixels (?rows=270 for chunkier / faster)

// Viewport rectangles as fractions of the screen: [x, y, w, h], y counted from the bottom.
// 1 player: full screen. 2 players: top/bottom halves. 3-4 players: quarters.
export function layoutFor(n) {
  if (n <= 1) return [[0, 0, 1, 1]];
  if (n === 2) return [[0, 0.5, 1, 0.5], [0, 0, 1, 0.5]];
  return [[0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5], [0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5]];
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d"), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function checkerTexture(cols, rows) {
  const texture = canvasTexture(cols * 4, rows * 4, (ctx) => {
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        ctx.fillStyle = (x + y) % 2 ? "#fff" : "#111";
        ctx.fillRect(x * 4, y * 4, 4, 4);
      }
    }
  });
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

// a small tile of speckled ground, repeated over the whole land
function groundTexture(color) {
  const base = new THREE.Color(color);
  const random = mulberry32(11);
  const texture = canvasTexture(32, 32, (ctx, w, h) => {
    ctx.fillStyle = `#${base.getHexString()}`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const shade = random() < 0.5 ? 0.88 : 1.1;
      ctx.fillStyle = `#${base.clone().multiplyScalar(shade).getHexString()}`;
      ctx.fillRect(Math.floor(random() * w), Math.floor(random() * h), 1 + Math.floor(random() * 2), 1);
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.repeat.set(250, 250);
  return texture;
}

function softTexture() {
  return canvasTexture(32, 32, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.5, "rgba(255,255,255,0.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

// pooled puffs of dust, tyre smoke and exhaust glow
function createParticles(scene) {
  const texture = softTexture();
  const pool = Array.from({ length: 160 }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.visible = false;
    scene.add(sprite);
    return { sprite, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1, grow: 1, alpha: 1 };
  });
  let next = 0;
  return {
    emit(x, y, z, vx, vy, vz, color, size, grow, life, alpha) {
      const p = pool[next];
      next = (next + 1) % pool.length;
      p.sprite.position.set(x, y, z);
      p.sprite.material.color.set(color);
      Object.assign(p, { vx, vy, vz, size, grow, life, max: life, alpha });
      p.sprite.visible = true;
    },
    update(dt) {
      for (const p of pool) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.sprite.visible = false;
          continue;
        }
        const t = 1 - p.life / p.max;
        p.sprite.position.x += p.vx * dt;
        p.sprite.position.y += p.vy * dt;
        p.sprite.position.z += p.vz * dt;
        p.sprite.scale.setScalar(p.size * (1 + p.grow * t));
        p.sprite.material.opacity = p.alpha * (1 - t);
      }
    },
    clear() {
      for (const p of pool) {
        p.life = 0;
        p.sprite.visible = false;
      }
    },
  };
}

// Builds triangles for a strip along the track. `quad(i, corners)` pushes the 4 corners
// (as [x,y,z]) of segment i and returns its colour.
function stripGeometry(track, quad) {
  const positions = [];
  const colors = [];
  const color = new THREE.Color();
  for (let i = 0; i < track.n; i++) {
    const corners = [];
    color.set(quad(i, corners));
    const [a, b, c, d] = corners; // a,b = start of segment, c,d = end
    for (const p of [a, b, c, b, d, c]) {
      positions.push(...p);
      colors.push(color.r, color.g, color.b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function buildTrackMeshes(track, world) {
  const half = track.halfWidth;
  const edgeAt = (i, lateral, y) => {
    const p = track.points[i];
    const t = track.tangent(i);
    return [p.x + t.z * lateral, y, p.z - t.x * lateral];
  };
  const edge = (i, side, y) => edgeAt(i, half * side, y);
  const material = () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  // paint on the road is drawn a hair above it; the offset stops it flickering at a distance
  const paintMaterial = () => {
    const m = material();
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    return m;
  };

  // road, with light and dark bands so speed is easy to see
  const road = stripGeometry(track, (i, out) => {
    const j = (i + 1) % track.n;
    out.push(edge(i, 1, 0), edge(i, -1, 0), edge(j, 1, 0), edge(j, -1, 0));
    return Math.floor(i / 4) % 2 ? 0x4a4a4a : 0x575757;
  });
  const roadMesh = new THREE.Mesh(road, material());
  roadMesh.receiveShadow = true;
  world.add(roadMesh);

  // red/white kerbs along both edges
  for (const side of [1, -1]) {
    const kerb = stripGeometry(track, (i, out) => {
      const j = (i + 1) % track.n;
      out.push(edgeAt(i, side * (half - 1.5), 0.02), edge(i, side, 0.02), edgeAt(j, side * (half - 1.5), 0.02), edge(j, side, 0.02));
      return Math.floor(i / 2) % 2 ? 0xdd2222 : 0xffffff;
    });
    const mesh = new THREE.Mesh(kerb, paintMaterial());
    mesh.receiveShadow = true;
    world.add(mesh);
  }

  // dashed centre line
  const dashes = stripGeometry(track, (i, out) => {
    const j = (i + 1) % track.n;
    out.push(edgeAt(i, 0.3, 0.02), edgeAt(i, -0.3, 0.02), edgeAt(j, 0.3, 0.02), edgeAt(j, -0.3, 0.02));
    return Math.floor(i / 3) % 2 ? (Math.floor(i / 4) % 2 ? 0x4a4a4a : 0x575757) : 0xeeeeee;
  });
  const dashMesh = new THREE.Mesh(dashes, paintMaterial());
  dashMesh.receiveShadow = true;
  world.add(dashMesh);

  // red/white walls on both sides
  for (const side of [1, -1]) {
    const wall = stripGeometry(track, (i, out) => {
      const j = (i + 1) % track.n;
      out.push(edge(i, side, 0), edge(i, side, 1), edge(j, side, 0), edge(j, side, 1));
      return Math.floor(i / 3) % 2 ? 0xdd2222 : 0xffffff;
    });
    world.add(new THREE.Mesh(wall, material()));
  }

  // start line + arch over it
  const t0 = track.tangent(0);
  const start = new THREE.Group();
  start.position.set(track.points[0].x, 0, track.points[0].z);
  start.rotation.y = Math.atan2(t0.x, t0.z);
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2, 3).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: checkerTexture(16, 4) }),
  );
  line.position.y = 0.02;
  const post = new THREE.CylinderGeometry(0.5, 0.5, 9, 8).translate(0, 4.5, 0);
  const postMat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(post, postMat);
    p.position.x = side * (half + 0.8);
    start.add(p);
  }
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(half * 2 + 3.2, 1.6, 0.8),
    new THREE.MeshBasicMaterial({ map: checkerTexture(32, 3) }),
  );
  bar.position.y = 9;
  start.add(line, bar);
  world.add(start);
}

function buildScenery(track, world) {
  const { ground: groundColor, crown, trunk } = track.theme;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: groundTexture(groundColor) }),
  );
  ground.receiveShadow = true;
  ground.position.y = -0.3;
  world.add(ground);

  // trees and rocks (instanced: a few draw calls for all of them)
  const random = mulberry32(7);
  const b = track.bounds;
  const spots = [];
  while (spots.length < 220) {
    const x = b.minX - 150 + random() * (b.maxX - b.minX + 300);
    const z = b.minZ - 150 + random() * (b.maxZ - b.minZ + 300);
    if (track.locate(x, z).dist > track.halfWidth + 8) spots.push([x, z, 0.8 + random() * 0.8]);
  }
  const trees = spots.slice(0, 170);
  const rocks = spots.slice(170);
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.4, 0.5, 3, 6).translate(0, 1.5, 0),
    new THREE.MeshLambertMaterial({ color: trunk }),
    trees.length,
  );
  const crowns = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2.8, 4.6, 8).translate(0, 4.2, 0),
    new THREE.MeshLambertMaterial({ color: crown }),
    trees.length,
  );
  const tops = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2, 4, 8).translate(0, 6.6, 0),
    new THREE.MeshLambertMaterial({ color: new THREE.Color(crown).multiplyScalar(1.35) }),
    trees.length,
  );
  for (const mesh of [trunks, crowns, tops]) mesh.castShadow = true;
  const stones = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1.4).translate(0, 0.6, 0),
    new THREE.MeshLambertMaterial({ color: 0x888888, flatShading: true }),
    rocks.length,
  );
  const m = new THREE.Matrix4();
  trees.forEach(([x, z, s], i) => {
    m.makeScale(s, s, s).setPosition(x, 0, z);
    trunks.setMatrixAt(i, m);
    crowns.setMatrixAt(i, m);
    tops.setMatrixAt(i, m);
  });
  rocks.forEach(([x, z, s], i) => {
    m.makeScale(s * 1.4, s, s * 1.2).setPosition(x, 0, z);
    stones.setMatrixAt(i, m);
  });
  world.add(trunks, crowns, tops, stones);

  // bushes close to the road
  const bushSpots = [];
  while (bushSpots.length < 160) {
    const x = b.minX - 40 + random() * (b.maxX - b.minX + 80);
    const z = b.minZ - 40 + random() * (b.maxZ - b.minZ + 80);
    const d = track.locate(x, z).dist;
    if (d > track.halfWidth + 3 && d < track.halfWidth + 14) bushSpots.push([x, z, 0.7 + random() * 0.7]);
  }
  const bushes = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1.1, 0).translate(0, 0.6, 0),
    new THREE.MeshLambertMaterial({ color: new THREE.Color(crown).multiplyScalar(1.2), flatShading: true }),
    bushSpots.length,
  );
  bushSpots.forEach(([x, z, s], i) => {
    m.makeScale(s * 1.3, s, s * 1.3).setPosition(x, 0, z);
    bushes.setMatrixAt(i, m);
  });
  bushes.castShadow = true;
  world.add(bushes);

  // mountains far away: they ignore the fog so the horizon is never empty
  const centre = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  const ring = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 560;
  const rock = new THREE.Color(groundColor).lerp(new THREE.Color(0x6a7fb0), 0.6).lerp(new THREE.Color(HORIZON), 0.2);
  const rockMat = new THREE.MeshLambertMaterial({ color: rock, flatShading: true, fog: false });
  const snowMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false });
  const count = 30;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + random() * 0.1;
    const height = 90 + random() * 120;
    const radius = 90 + random() * 70;
    const mountain = new THREE.Group();
    mountain.add(new THREE.Mesh(new THREE.ConeGeometry(radius, height, 6 + (i % 3)).translate(0, height / 2, 0), rockMat));
    mountain.add(new THREE.Mesh(new THREE.ConeGeometry(radius * 0.38, height * 0.36, 6 + (i % 3)).translate(0, height * 0.18, 0), snowMat));
    mountain.children[1].position.y = height * 0.64;
    mountain.position.set(centre.x + Math.cos(a) * ring * (0.95 + random() * 0.1), -2, centre.z + Math.sin(a) * ring * (0.95 + random() * 0.1));
    mountain.rotation.y = random() * 3;
    world.add(mountain);
  }
}

function buildClouds() {
  const random = mulberry32(3);
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const clouds = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    for (let b = 0; b < 4; b++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(10 + random() * 8, 8, 6), cloudMat);
      puff.position.set(b * 14 - 20, random() * 4, random() * 8);
      puff.scale.y = 0.45;
      cloud.add(puff);
    }
    cloud.position.set((random() - 0.5) * 900, 110 + random() * 40, (random() - 0.5) * 900);
    clouds.add(cloud);
  }
  return clouds;
}

function blobShadowTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(0,0,0,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

function nameTag(name, color) {
  const texture = canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 8, w, h - 16);
    ctx.fillStyle = color;
    ctx.fillRect(0, 8, 14, h - 16);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 34px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, w / 2 + 6, h / 2 + 1);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, fog: false }));
  sprite.scale.set(3, 0.75, 1);
  sprite.position.y = 3.2;
  return sprite;
}

// A low-poly kart. Returns the group plus the parts that animate.
function buildKart(k, shadowTexture) {
  const root = new THREE.Group(); // position + heading
  const tilt = new THREE.Group(); // leans in corners
  root.add(tilt);
  const look = k.look; // the driver's look from the phone (outfit colour, hair, extras)
  const paint = new THREE.MeshPhongMaterial({ color: look?.outfit ?? k.color, shininess: 70, specular: 0x555555 }); // glossy paint
  const hairMat = new THREE.MeshLambertMaterial({ color: look?.hairColor ?? 0xffffff });
  const skinMat = new THREE.MeshLambertMaterial({ color: look?.skin ?? 0xe0a47a });
  const dark = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const white = new THREE.MeshLambertMaterial({ color: 0xffffff });

  const add = (geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    tilt.add(mesh);
    return mesh;
  };
  add(new THREE.BoxGeometry(1.8, 0.6, 3), paint, 0, 0.7, 0); // body
  add(new THREE.BoxGeometry(1.2, 0.4, 1.2), paint, 0, 0.6, 1.9); // nose
  add(new THREE.BoxGeometry(0.4, 0.15, 0.4), dark, 0, 1.05, 1.9); // intake
  add(new THREE.BoxGeometry(2.4, 0.15, 0.5), dark, 0, 0.35, 2.55); // front wing
  add(new THREE.BoxGeometry(2, 0.15, 0.6), dark, 0, 1.55, -1.55); // rear wing
  add(new THREE.BoxGeometry(1.4, 0.55, 0.15), dark, 0, 1.2, -1.5); // wing struts
  add(new THREE.BoxGeometry(0.5, 0.05, 2.6), look ? hairMat : white, 0, 1.02, 0); // stripe
  add(new THREE.BoxGeometry(0.9, 0.4, 0.9), dark, 0, 1.1, -0.35); // seat
  add(new THREE.SphereGeometry(0.4, 8, 6), look ? (look.hairStyle === 4 ? skinMat : hairMat) : white, 0, 1.55, -0.3); // helmet
  const visorMat = look?.accessory === 1 ? new THREE.MeshBasicMaterial({ color: look.hairColor }) : dark;
  add(new THREE.BoxGeometry(0.5, 0.18, 0.3), visorMat, 0, 1.58, -0.0); // visor
  if (look?.accessory === 2) add(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 10), new THREE.MeshLambertMaterial({ color: look.outfit }), 0, 1.66, -0.3); // headband
  if (look) {
    // hair: a few cones, a ridge or a flat top on the helmet
    const spike = (x, z, tiltZ, tiltX = 0) => {
      const m = add(new THREE.ConeGeometry(0.11, 0.45, 5), hairMat, x, 2.0, z);
      m.rotation.z = tiltZ;
      m.rotation.x = tiltX;
    };
    if (look.hairStyle === 0) {
      spike(0, -0.3, 0);
      spike(-0.2, -0.3, 0.4);
      spike(0.2, -0.3, -0.4);
    } else if (look.hairStyle === 1) {
      spike(-0.22, -0.4, 0.8, -0.3);
      spike(0.22, -0.4, -0.8, -0.3);
      spike(0, -0.55, 0, -0.9);
    } else if (look.hairStyle === 2) {
      add(new THREE.BoxGeometry(0.1, 0.32, 0.7), hairMat, 0, 1.98, -0.3);
    } else if (look.hairStyle === 3) {
      add(new THREE.BoxGeometry(0.55, 0.14, 0.55), hairMat, 0, 1.94, -0.3);
    }
  }
  for (const side of [-1, 1]) add(new THREE.CylinderGeometry(0.15, 0.2, 0.9, 8).rotateX(Math.PI / 2), dark, side * 1.0, 0.7, -1.9); // exhausts

  // driver: body, arms on the steering wheel
  const suit = new THREE.MeshLambertMaterial({ color: new THREE.Color(look?.outfit ?? k.color).multiplyScalar(0.7) });
  add(new THREE.BoxGeometry(0.7, 0.5, 0.42), suit, 0, 1.3, -0.58); // torso
  add(new THREE.TorusGeometry(0.22, 0.04, 6, 14), dark, 0, 1.3, 0.38).rotation.x = -1.0; // steering wheel
  for (const side of [-1, 1]) {
    const arm = add(new THREE.BoxGeometry(0.17, 0.17, 0.75), suit, side * 0.36, 1.3, -0.02);
    arm.rotation.x = 0.35;
    add(new THREE.SphereGeometry(0.1, 6, 5), skinMat, side * 0.26, 1.2, 0.36); // hands
  }

  // side pods, fenders over the wheels, lights
  const glow = (color) => new THREE.MeshBasicMaterial({ color });
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.42, 0.42, 1.5), paint, side * 1.02, 0.66, -0.05);
    add(new THREE.BoxGeometry(0.55, 0.1, 1.05), paint, side * 1.0, 1.0, 1.3);
    add(new THREE.BoxGeometry(0.55, 0.1, 1.05), paint, side * 1.0, 1.0, -1.2);
    add(new THREE.BoxGeometry(0.3, 0.16, 0.1), glow(0xfff6b0), side * 0.45, 0.66, 2.52); // headlights
    add(new THREE.BoxGeometry(0.4, 0.12, 0.08), glow(0xff2a2a), side * 0.5, 0.78, -1.52); // brake lights
  }

  // wheels: a pivot (steers) holding the tyre (spins)
  const tyreGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.45, 16).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.5, 8).rotateZ(Math.PI / 2);
  const hubMat = new THREE.MeshPhongMaterial({ color: 0xdddddd, shininess: 90 });
  const wheels = [];
  for (const [x, z, front] of [[-1, 1.3, true], [1, 1.3, true], [-1, -1.2, false], [1, -1.2, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x * 1.0, 0.48, z);
    const tyre = new THREE.Mesh(tyreGeo, dark);
    tyre.add(new THREE.Mesh(hubGeo, hubMat)); // the hub makes the spin visible
    pivot.add(tyre);
    tilt.add(pivot);
    wheels.push({ pivot, tyre, front });
  }

  // boost flames at the exhausts
  const flames = new THREE.Group();
  const flameGeo = new THREE.ConeGeometry(0.3, 1.6, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.8);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a1f, fog: false });
  for (const side of [-1, 1]) {
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(side * 1.0, 0.7, -2.35);
    flames.add(flame);
  }
  flames.visible = false;
  tilt.add(flames);

  // drift sparks at the rear wheels; colour shows the boost you will get
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const sparks = new THREE.Group();
  for (const side of [-1, 1]) {
    const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), sparkMat);
    spark.position.set(side * 1.2, 0.3, -1.6);
    sparks.add(spark);
  }
  sparks.visible = false;
  tilt.add(sparks);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 4.4).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, fog: false }),
  );
  shadow.position.y = 0.06;
  root.add(shadow);

  const tag = nameTag(k.name, k.color);
  root.add(tag);

  root.traverse((o) => {
    if (o.isMesh && o !== shadow) o.castShadow = true;
  });

  return { root, tilt, wheels, tag, flames, sparks, sparkMat, steer: 0, skew: 0, acc: 0 };
}

function buildBox() {
  const face = canvasTexture(64, 64, (ctx, w, h) => {
    ctx.fillStyle = "#ffc400";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#b86e00";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 46px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", w / 2, h / 2 + 3);
  });
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.6, 1.6),
    new THREE.MeshLambertMaterial({ map: face, emissive: 0x664400, transparent: true, opacity: 0.95 }),
  );
  return box;
}

function buildBanana() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffe14a });
  const a = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 1.2), mat);
  a.position.y = 0.3;
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.7), mat);
  b.position.set(0, 0.55, 0.7);
  b.rotation.x = -0.7;
  g.add(a, b);
  return g;
}

function buildRocket() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 1.8, 8).rotateX(Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xdd2222 }),
  );
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 0.8, 8).rotateX(Math.PI / 2).translate(0, 0, 1.3),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
  );
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.25, 1.2, 6).rotateX(-Math.PI / 2).translate(0, 0, -1.5),
    new THREE.MeshBasicMaterial({ color: 0xffaa22, fog: false }),
  );
  g.add(body, nose, flame);
  g.position.y = 0.9;
  return g;
}

function disposeGroup(group) {
  group.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
}

export function createGfx(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const size = { w: 480, h: 270 }; // internal resolution, set in resize()
  renderer.setClearColor(0x000000);

  const scene = new THREE.Scene();
  scene.background = canvasTexture(2, 256, (ctx, w, h) => {
    // flat colour bands, like an 8-bit sky
    const bands = ["#5c94fc", "#5c94fc", "#6ca0fc", "#80b0fc", "#94c0fc", "#a4d0fc", "#a4d0fc", "#a4d0fc"];
    bands.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(0, (i * h) / bands.length, w, h / bands.length + 1);
    });
  });
  scene.fog = new THREE.Fog(HORIZON, 90, 440);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x446644, 1.25));
  const sun = new THREE.DirectionalLight(0xfff2d6, 2.1);
  const SUN_OFFSET = new THREE.Vector3(60, 120, 40);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.3;
  scene.add(sun, sun.target);
  // the shadow map only covers a square around the point of interest (a kart, or the whole track)
  function aimSun(x, z, half) {
    sun.target.position.set(x, 0, z);
    sun.position.set(x + SUN_OFFSET.x, SUN_OFFSET.y, z + SUN_OFFSET.z);
    const c = sun.shadow.camera;
    if (c.right !== half) {
      Object.assign(c, { left: -half, right: half, top: half, bottom: -half });
      c.updateProjectionMatrix();
    }
  }
  const particles = createParticles(scene);
  let dustColor = 0xcccccc;
  const clouds = buildClouds();
  scene.add(clouds);

  const shadowTexture = blobShadowTexture();
  const overview = new THREE.PerspectiveCamera(55, 1, 1, 3000);
  let orbit = 0;
  let world = null; // everything that belongs to the current track
  let overviewShape = { cx: 0, cz: 0, radius: 260 };
  let karts3d = new Map(); // kart id -> { root, tilt, wheels, tag, ... }
  let views = []; // { camera, heading }
  let boxMeshes = [];
  let bananaMeshes = [];
  let rocketMeshes = [];
  let kartLayer = new THREE.Group(); // karts + items of the current race
  scene.add(kartLayer);

  function resize() {
    const aspect = window.innerWidth / window.innerHeight;
    size.h = PIXEL_ROWS;
    size.w = Math.round(PIXEL_ROWS * aspect);
    renderer.setSize(size.w, size.h, false); // canvas CSS stays 100%, so the browser scales it up
  }
  window.addEventListener("resize", resize);
  resize();

  function setTrack(track) {
    if (world) {
      scene.remove(world);
      disposeGroup(world);
    }
    world = new THREE.Group();
    buildTrackMeshes(track, world);
    buildScenery(track, world);
    scene.add(world);
    dustColor = new THREE.Color(track.theme.ground).multiplyScalar(0.75);
    const b = track.bounds;
    overviewShape = {
      cx: (b.minX + b.maxX) / 2,
      cz: (b.minZ + b.maxZ) / 2,
      radius: Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.95,
    };
  }

  // Build the meshes for one race: karts, item boxes (bananas and rockets come and go).
  function setRace(race) {
    clearRace();
    for (const k of race.karts) {
      const k3 = buildKart(k, shadowTexture);
      kartLayer.add(k3.root);
      karts3d.set(k.id, k3);
      views.push({ camera: new THREE.PerspectiveCamera(65, 1, 1, 3000), heading: k.heading });
    }
    boxMeshes = race.itemBoxes.map((b) => {
      const mesh = buildBox();
      mesh.position.set(b.x, 1.4, b.z);
      kartLayer.add(mesh);
      return mesh;
    });
  }

  function clearRace() {
    particles.clear();
    kartLayer.clear();
    karts3d = new Map();
    views = [];
    boxMeshes = [];
    bananaMeshes = [];
    rocketMeshes = [];
  }

  // keep one mesh per entry of `list`
  function syncPool(pool, list, make) {
    while (pool.length < list.length) {
      const mesh = make();
      kartLayer.add(mesh);
      pool.push(mesh);
    }
    while (pool.length > list.length) kartLayer.remove(pool.pop());
  }

  function animateKart(k, k3, dt, time) {
    k3.root.position.set(k.x, 0, k.z);
    k3.skew += ((k.drifting ? k.driftDir * 0.4 : 0) - k3.skew) * (1 - Math.exp(-10 * dt)); // nose points into the drift
    const spin = k.stun > 0 ? (1 - k.stun / STUN_TIME) * Math.PI * 4 : 0; // two turns when hit
    k3.root.rotation.y = k.heading + k3.skew + spin;
    k3.steer += ((k.steer ?? 0) - k3.steer) * (1 - Math.exp(-12 * dt));
    k3.tilt.rotation.z = -k3.steer * Math.min(Math.abs(k.speed) / 30, 1) * 0.09; // lean into the turn
    for (const w of k3.wheels) {
      w.tyre.rotation.x += (k.speed * dt) / 0.48;
      if (w.front) w.pivot.rotation.y = k3.steer * 0.45;
    }
    k3.flames.visible = k.boost > 0;
    if (k.boost > 0) k3.flames.scale.set(1, 1, 0.8 + 0.5 * Math.abs(Math.sin(time * 40)));
    k3.sparks.visible = k.drifting;
    if (k.drifting) {
      k3.sparkMat.color.set(k.driftCharge > 1.6 ? 0xff8a00 : k.driftCharge > 0.8 ? 0x39a7ff : 0xffffff);
      k3.sparks.scale.setScalar(0.7 + 0.6 * Math.abs(Math.sin(time * 35)));
    }
  }

  // dust behind the wheels, tyre smoke in drifts, glow at the exhausts when boosting
  function emitFx(k, k3, dt) {
    const speed = Math.abs(k.speed);
    if (speed < 8 && !k.drifting) return;
    k3.acc += dt;
    const step = k.drifting ? 0.03 : k.boost > 0 ? 0.03 : 0.07;
    if (k3.acc < step) return;
    k3.acc = 0;
    const sin = Math.sin(k.heading);
    const cos = Math.cos(k.heading);
    const r = () => Math.random() - 0.5;
    for (const side of [-1, 1]) {
      const x = k.x - sin * 1.3 + cos * side * 1.0;
      const z = k.z - cos * 1.3 - sin * side * 1.0;
      if (k.drifting) particles.emit(x, 0.35, z, r() * 2, 1.4, r() * 2, 0xe8e8e8, 1.1, 2.4, 0.7, 0.6);
      else particles.emit(x, 0.25, z, r() * 1.2, 0.7, r() * 1.2, dustColor, 0.8, 2, 0.55, speed > 20 ? 0.45 : 0.28);
      if (k.boost > 0) {
        const ex = k.x - sin * 2.4 + cos * side * 1.0;
        const ez = k.z - cos * 2.4 - sin * side * 1.0;
        particles.emit(ex, 0.7, ez, -sin * 6, 0.3, -cos * 6, 0xffa030, 0.9, -0.3, 0.35, 0.9);
      }
    }
  }

  function renderRace(race, dt) {
    const karts = race.karts;
    scene.fog.far = 440; // the lobby fly-over is much further out and uses a clear view
    scene.fog.near = 90;
    clouds.visible = true;
    const W = size.w;
    const H = size.h;
    const time = performance.now() / 1000;
    karts.forEach((k) => {
      animateKart(k, karts3d.get(k.id), dt, time);
      emitFx(k, karts3d.get(k.id), dt);
    });
    particles.update(dt);

    race.itemBoxes.forEach((box, i) => {
      const mesh = boxMeshes[i];
      mesh.visible = box.cooldown <= 0;
      mesh.rotation.y = time * 2;
      mesh.position.y = 1.4 + Math.sin(time * 3 + i) * 0.2;
    });
    syncPool(bananaMeshes, race.bananas, buildBanana);
    race.bananas.forEach((b, i) => bananaMeshes[i].position.set(b.x, 0, b.z));
    syncPool(rocketMeshes, race.rockets, buildRocket);
    race.rockets.forEach((r, i) => {
      rocketMeshes[i].position.set(r.x, 0.9, r.z);
      rocketMeshes[i].rotation.y = r.heading;
    });
    clouds.position.x += dt * 1.5;

    // 3 players use 3 quarters: paint the unused one dark
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, W, H);
    renderer.setScissor(W / 2, 0, W / 2, H / 2);
    renderer.setClearColor(0x111111);
    renderer.clear();
    const layout = layoutFor(karts.length);
    karts.forEach((k, i) => {
      const view = views[i];
      const [fx, fy, fw, fh] = layout[i];
      const vx = Math.round(fx * W);
      const vy = Math.round(fy * H);
      const vw = Math.round(fw * W);
      const vh = Math.round(fh * H);

      // the camera turns a little slower than the kart, which makes steering feel good
      view.heading += wrapAngle(k.heading - view.heading) * (1 - Math.exp(-6 * dt));
      const cx = Math.sin(view.heading);
      const cz = Math.cos(view.heading);
      const cam = view.camera;
      cam.aspect = vw / vh;
      cam.fov = 65 + Math.min(Math.abs(k.speed), 42) * 0.4;
      cam.updateProjectionMatrix();
      cam.position.set(k.x - cx * 8, 4, k.z - cz * 8);
      cam.lookAt(k.x + cx * 6, 1.5, k.z + cz * 6);

      // you don't need a name tag over your own kart
      // (and tags are hidden when the kart is so close that the tag would block the view)
      karts.forEach((other) => {
        const near = Math.hypot(other.x - cam.position.x, other.z - cam.position.z) < 14;
        karts3d.get(other.id).tag.visible = other !== k && !near;
      });

      aimSun(k.x, k.z, 48);
      renderer.setViewport(vx, vy, vw, vh);
      renderer.setScissor(vx, vy, vw, vh);
      renderer.render(scene, cam);
    });
  }

  // slow flight around the track, used behind the lobby
  function renderOverview(dt) {
    orbit += dt * 0.08;
    scene.fog.near = 3000;
    scene.fog.far = 6000;
    clouds.visible = false;
    const { cx, cz, radius } = overviewShape;
    overview.aspect = size.w / size.h;
    overview.updateProjectionMatrix();
    overview.position.set(cx + Math.cos(orbit) * radius * 1.0, radius * 0.55, cz + Math.sin(orbit) * radius * 1.0);
    overview.lookAt(cx, 0, cz);
    aimSun(cx, cz, radius * 1.1);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.w, size.h);
    renderer.render(scene, overview);
  }

  return { setTrack, setRace, clearRace, renderRace, renderOverview };
}
