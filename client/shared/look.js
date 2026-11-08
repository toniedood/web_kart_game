// A player's look, chosen on the phone and used by the fighters and the karts.
// Only values from these lists are accepted, so a bad message can't break the host.
export const HAIR_STYLES = ["SPIKY", "WILD", "MOHAWK", "FLAT", "BALD"];
export const ACCESSORIES = ["NONE", "VISOR", "BAND"];
export const HAIR_COLORS = ["#00f0ff", "#ffe14d", "#ff3d9a", "#eeeef8", "#ff8a3a", "#58d854", "#8a5ac8", "#2a1a14"];
export const SKINS = ["#f6c9a8", "#e0a47a", "#b9784e", "#7a4a2e"];
export const OUTFITS = ["#e53935", "#1e88e5", "#43a047", "#fdd835", "#8a5ac8", "#f08ab8", "#f08a3a", "#38b7a8", "#eeeeee", "#2c2c34"];

export const DEFAULT_LOOK = { hairStyle: 0, hairColor: HAIR_COLORS[0], skin: SKINS[1], outfit: null, accessory: 1 };

// outfit null = "auto": use the colour the server gave the player
export function cleanLook(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const pick = (list, v, d) => (list.includes(v) ? v : d);
  const index = (v, n, d) => (Number.isInteger(v) && v >= 0 && v < n ? v : d);
  return {
    hairStyle: index(r.hairStyle, HAIR_STYLES.length, DEFAULT_LOOK.hairStyle),
    hairColor: pick(HAIR_COLORS, r.hairColor, DEFAULT_LOOK.hairColor),
    skin: pick(SKINS, r.skin, DEFAULT_LOOK.skin),
    outfit: OUTFITS.includes(r.outfit) ? r.outfit : null,
    accessory: index(r.accessory, ACCESSORIES.length, DEFAULT_LOOK.accessory),
  };
}

export function resolveLook(raw, fallbackOutfit) {
  const look = cleanLook(raw);
  return { ...look, outfit: look.outfit ?? fallbackOutfit };
}

export function randomLook() {
  const any = (list) => list[Math.floor(Math.random() * list.length)];
  return {
    hairStyle: Math.floor(Math.random() * HAIR_STYLES.length),
    hairColor: any(HAIR_COLORS),
    skin: any(SKINS),
    outfit: null,
    accessory: Math.floor(Math.random() * ACCESSORIES.length),
  };
}

const BOT_LOOKS = [
  { hairStyle: 0, hairColor: HAIR_COLORS[0], skin: SKINS[1], accessory: 1 },
  { hairStyle: 1, hairColor: HAIR_COLORS[1], skin: SKINS[2], accessory: 0 },
  { hairStyle: 2, hairColor: HAIR_COLORS[2], skin: SKINS[0], accessory: 0 },
  { hairStyle: 3, hairColor: HAIR_COLORS[3], skin: SKINS[3], accessory: 2 },
];
export function botLook(index, outfit) {
  return { ...BOT_LOOKS[index % BOT_LOOKS.length], outfit };
}
