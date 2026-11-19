// SOLMAR HEAT — shared constants and seeded RNG.
// Every module in the game imports only 'three' and this file.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const RNG_SEED = 1337;

// City grid: 8x8 blocks of 46 units, 9 roads of 14 units between/around them.
// 8 * 46 + 9 * 14 = 494, so the city spans -247..+247. Road centers sit at
// -240 + i * 60. BOUND is the play clamp, just inside the outer road edge.
export const CITY = {
  BLOCKS: 8,
  BLOCK: 46,
  ROAD: 14,
  STEP: 60,
  BOUND: 245,
  ROAD_CENTERS: [-240, -180, -120, -60, 0, 60, 120, 180, 240],
};

export const PALETTE = {
  sky: 0x8fd3e8,
  sun: 0xfff2d9,
  ground: 0x6b7a5e,
  road: 0x33373d,
  sidewalk: 0x9a938a,
  sand: 0xe8d49a,
  water: 0x2e86ab,
  buildings: [0xd9c9a8, 0xc9b8a3, 0xb8c4c9, 0xd9a08c, 0xa8b8a0, 0xcfc4d9],
  cars: [0xc0392b, 0x2980b9, 0xf1c40f, 0xecf0f1, 0x2c3e50, 0x27ae60, 0xe67e22, 0x8e44ad],
};

export const TUNING = {
  walkSpeed: 6,
  runSpeed: 10,
  carAccel: 14,
  carMaxSpeed: 42,
  carBrake: 30,
  carReverseMax: 12,
  steerRate: 1.9,
  policeTopSpeed: 46,
  playerHealth: 100,
  gunDamage: 34,
  gunRange: 90,
  gunCooldown: 0.22,
};

export const NAMES = {
  game: 'SOLMAR HEAT',
  city: 'Solmar City',
  player: 'Mara Voss',
  fixer: 'Dante Kroll',
  mechanic: 'Ivy Chen',
  boss: 'Viktor Hale',
  streets: [
    'Meridian Ave',
    'Coral Way',
    'Solstice Blvd',
    'Harbor Road',
    'Palm Row',
    'Foundry Street',
    'Beacon Lane',
    'Marina Drive',
  ],
};
