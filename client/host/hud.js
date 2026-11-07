import { layoutFor } from "./scene.js";

const ORDINALS = ["1st", "2nd", "3rd", "4th"];
export const ITEM_LABELS = { boost: "🍄 BOOST", banana: "🍌 BANANA", rocket: "🚀 ROCKET" };

// One overlay cell per split-screen view: name, lap, position, speed.
export function createHud(container, karts, track) {
  container.innerHTML = "";
  const layout = layoutFor(karts.length);
  const cells = karts.map((k, i) => {
    const [x, y, w, h] = layout[i];
    const el = document.createElement("div");
    el.className = "cell";
    // in the 4-way split the minimap sits where the 4 views meet: move that corner's text away
    if (karts.length >= 3) el.classList.add(["j-speed", "j-pos", "j-lap", "j-name"][i]);
    Object.assign(el.style, {
      left: `${x * 100}%`,
      top: `${(1 - y - h) * 100}%`,
      width: `${w * 100}%`,
      height: `${h * 100}%`,
    });
    el.innerHTML =
      '<div class="name"></div><div class="lap"></div><div class="pos"></div>' +
      '<div class="speed"></div><div class="item"></div><div class="done"></div>';
    const q = (cls) => el.querySelector(`.${cls}`);
    q("name").textContent = k.name;
    q("name").style.borderColor = k.color;
    container.append(el);
    return { kart: k, lap: q("lap"), pos: q("pos"), speed: q("speed"), item: q("item"), done: q("done"), last: {} };
  });

  // minimap: the track is drawn once, the karts are dots on top
  const SIZE = 220;
  const map = document.createElement("canvas");
  map.width = SIZE;
  map.height = SIZE;
  map.className = karts.length === 1 ? "minimap bottom" : "minimap center";
  container.append(map);
  const mctx = map.getContext("2d");
  const xs = track.points.map((p) => p.x);
  const zs = track.points.map((p) => p.z);
  const minX = Math.min(...xs);
  const minZ = Math.min(...zs);
  const scale = (SIZE - 36) / Math.max(Math.max(...xs) - minX, Math.max(...zs) - minZ);
  const mx = (x) => 18 + (x - minX) * scale;
  const my = (z) => SIZE - (18 + (z - minZ) * scale); // z up = screen up
  const base = document.createElement("canvas");
  base.width = SIZE;
  base.height = SIZE;
  {
    const c = base.getContext("2d");
    c.fillStyle = "rgba(0,0,0,0.45)";
    c.beginPath();
    c.roundRect(0, 0, SIZE, SIZE, 18);
    c.fill();
    c.lineJoin = "round";
    c.beginPath();
    track.points.forEach((p, i) => (i ? c.lineTo(mx(p.x), my(p.z)) : c.moveTo(mx(p.x), my(p.z))));
    c.closePath();
    c.strokeStyle = "#fff";
    c.lineWidth = 8;
    c.stroke();
    c.strokeStyle = "#555";
    c.lineWidth = 5;
    c.stroke();
    c.fillStyle = "#fff"; // start line
    c.fillRect(mx(track.points[0].x) - 5, my(track.points[0].z) - 2, 10, 4);
  }

  function drawMap() {
    mctx.clearRect(0, 0, SIZE, SIZE);
    mctx.drawImage(base, 0, 0);
    for (const k of karts) {
      mctx.beginPath();
      mctx.arc(mx(k.x), my(k.z), 6, 0, Math.PI * 2);
      mctx.fillStyle = k.color;
      mctx.fill();
      mctx.strokeStyle = "#fff";
      mctx.lineWidth = 2;
      mctx.stroke();
    }
  }

  // only touch the DOM when a value changed
  function set(cell, key, value) {
    if (cell.last[key] === value) return;
    cell.last[key] = value;
    cell[key].textContent = value;
  }

  function update(race) {
    drawMap();
    for (const cell of cells) {
      const k = cell.kart;
      set(cell, "lap", `LAP ${k.lap}/${race.laps}`);
      set(cell, "pos", `${ORDINALS[k.position - 1]} / ${cells.length}`);
      set(cell, "speed", `${Math.round(Math.abs(k.speed) * 3.6)} km/h`);
      set(cell, "item", k.item ? ITEM_LABELS[k.item] : "");
      set(cell, "done", k.finished ? "FINISHED" : k.connected ? "" : "DISCONNECTED");
    }
  }

  return { update };
}
