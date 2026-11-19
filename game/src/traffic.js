// traffic.js — AI traffic cars driving the road grid + sidewalk pedestrians.
// Part of SOLMAR HEAT (make.fun gta6-01). All content original.
import * as THREE from 'three';
import { CITY, mulberry32, RNG_SEED } from './config.js';

const TRAFFIC_COUNT = 8;
const PED_COUNT = 16;
const LANE_OFFSET = 3.5; // right-hand traffic: drive on the right of the road
const CRUISE_MIN = 10;
const CRUISE_MAX = 14;
const TURN_RATE = 2.6;
const BRAKE_DIST = 9;
const RESPAWN_DIST = 260;
const FLEE_SPEED = 4;
const FLEE_TIME = 3;
const DOWN_TIME = 4;
const HIT_SPEED = 8;
const HIT_DIST = 2.4;

// Pedestrian shirt colors.
const SHIRTS = [0xd95d4e, 0x4e7dd9, 0x53b06a, 0xe0a83c, 0x9b5fb0, 0x48b8b0, 0xe07ba7, 0x8a8f98];

// Shared pedestrian geometry.
const pedBodyGeo = new THREE.CapsuleGeometry(0.22, 0.62, 4, 8);
const pedHeadGeo = new THREE.SphereGeometry(0.16, 10, 8);
const pedHairGeo = new THREE.SphereGeometry(0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
const pedSkinMat = new THREE.MeshStandardMaterial({ color: 0xc98d64, roughness: 0.7 });
const pedHairMat = new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.9 });
const shirtCache = new Map();
function shirtMaterial(color) {
  let m = shirtCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    shirtCache.set(color, m);
  }
  return m;
}

const _to = new THREE.Vector3();
const _away = new THREE.Vector3();

function angleDelta(target, current) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Right-hand vector (x,z) for a travel direction (dx,dz): (-dz, dx).
function rightOf(dx, dz) {
  return { x: -dz, z: dx };
}

export function createTraffic(G) {
  const rng = mulberry32(RNG_SEED + 23);
  const centers = CITY.ROAD_CENTERS;
  const last = centers.length - 1;
  const trafficCars = [];
  const pedestrians = [];
  const counts = { cars: 0, peds: 0 };

  const traffic = {
    update,
    trafficCars,
    pedestrians,
    counts,
  };

  // ---- Local fallbacks (used only if the city system is not ready yet) ----
  function randomRoadPointLocal() {
    const alongRoad = rng() < 0.5;
    const center = centers[Math.floor(rng() * centers.length)];
    const along = (rng() * 2 - 1) * (CITY.BOUND - 20);
    return alongRoad ? { x: along, z: center } : { x: center, z: along };
  }

  function randomSidewalkPointLocal() {
    // A point just inside a block edge (sidewalk ring around a block).
    const blockSpan = CITY.BLOCK + CITY.ROAD; // 60
    const half = (CITY.BLOCKS * blockSpan) / 2;
    const bi = Math.floor(rng() * CITY.BLOCKS);
    const bj = Math.floor(rng() * CITY.BLOCKS);
    const bx = -half + CITY.ROAD + bi * blockSpan;
    const bz = -half + CITY.ROAD + bj * blockSpan;
    const edge = Math.floor(rng() * 4);
    const t = rng() * CITY.BLOCK;
    if (edge === 0) return { x: bx + t, z: bz + 1.5 };
    if (edge === 1) return { x: bx + t, z: bz + CITY.BLOCK - 1.5 };
    if (edge === 2) return { x: bx + 1.5, z: bz + t };
    return { x: bx + CITY.BLOCK - 1.5, z: bz + t };
  }

  function cityRoadPoint() {
    if (G.city && typeof G.city.randomRoadPoint === 'function') {
      return G.city.randomRoadPoint(rng);
    }
    return randomRoadPointLocal();
  }

  function citySidewalkPoint() {
    if (G.city && typeof G.city.randomSidewalkPoint === 'function') {
      return G.city.randomSidewalkPoint(rng);
    }
    return randomSidewalkPointLocal();
  }

  function playerPos() {
    if (G.player && typeof G.player.getPosition === 'function') {
      return G.player.getPosition();
    }
    return _to.set(0, 0, 8);
  }

  // ---- Traffic cars ----

  // Pick a random intersection (grid indices) and a valid travel direction.
  function randomStart() {
    const ix = Math.floor(rng() * centers.length);
    const iz = Math.floor(rng() * centers.length);
    const dirs = [];
    if (ix > 0) dirs.push({ dx: -1, dz: 0 });
    if (ix < last) dirs.push({ dx: 1, dz: 0 });
    if (iz > 0) dirs.push({ dx: 0, dz: -1 });
    if (iz < last) dirs.push({ dx: 0, dz: 1 });
    const dir = dirs[Math.floor(rng() * dirs.length)];
    return { ix, iz, dir };
  }

  function waypointFor(ix, iz, dir) {
    const r = rightOf(dir.dx, dir.dz);
    return {
      x: centers[ix] + r.x * LANE_OFFSET,
      z: centers[iz] + r.z * LANE_OFFSET,
    };
  }

  function spawnTrafficCar() {
    const start = randomStart();
    const r = rightOf(start.dir.dx, start.dir.dz);
    const x = centers[start.ix] + r.x * LANE_OFFSET;
    const z = centers[start.iz] + r.z * LANE_OFFSET;
    const heading = Math.atan2(start.dir.dx, start.dir.dz);
    const types = ['sedan', 'sedan', 'taxi', 'van', 'sport', 'truck'];
    const type = types[Math.floor(rng() * types.length)];
    const car = G.vehicles.spawnCar(type, x, z, heading, 'traffic');
    const ai = {
      car,
      ix: start.ix,
      iz: start.iz,
      dir: { dx: start.dir.dx, dz: start.dir.dz },
      waypoint: null,
      cruise: CRUISE_MIN + rng() * (CRUISE_MAX - CRUISE_MIN),
    };
    pickNextWaypoint(ai);
    trafficCars.push(ai);
    return ai;
  }

  // At the current intersection, choose the next one: mostly straight,
  // sometimes left or right, never a U-turn, never off the grid.
  function pickNextWaypoint(ai) {
    const { dx, dz } = ai.dir;
    const options = [];
    const straight = { dx, dz, w: 0.55 };
    const left = { dx: dz, dz: -dx, w: 0.225 }; // left of (dx,dz)
    const right = { dx: -dz, dz: dx, w: 0.225 };
    for (const o of [straight, left, right]) {
      const nix = ai.ix + o.dx;
      const niz = ai.iz + o.dz;
      if (nix < 0 || nix > last || niz < 0 || niz > last) continue;
      options.push({ ...o, nix, niz });
    }
    if (options.length === 0) {
      // Dead end (should not happen on a full grid): reverse.
      ai.dir = { dx: -dx, dz: -dz };
      ai.waypoint = waypointFor(ai.ix, ai.iz, ai.dir);
      return;
    }
    let total = 0;
    for (const o of options) total += o.w;
    let roll = rng() * total;
    let chosen = options[0];
    for (const o of options) {
      roll -= o.w;
      if (roll <= 0) { chosen = o; break; }
    }
    ai.dir = { dx: chosen.dx, dz: chosen.dz };
    ai.ix = chosen.nix;
    ai.iz = chosen.niz;
    ai.waypoint = waypointFor(ai.ix, ai.iz, ai.dir);
  }

  function obstacleAhead(ai) {
    const car = ai.car;
    const px = car.group.position.x;
    const pz = car.group.position.z;
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const all = G.vehicles.cars;
    for (let i = 0; i < all.length; i++) {
      const other = all[i];
      if (other === car) continue;
      const ox = other.group.position.x - px;
      const oz = other.group.position.z - pz;
      const d2 = ox * ox + oz * oz;
      if (d2 > BRAKE_DIST * BRAKE_DIST) continue;
      const dot = (ox * fx + oz * fz) / Math.max(0.001, Math.sqrt(d2));
      if (dot > 0.75) return true;
    }
    // Brake for the player on foot crossing ahead.
    if (G.player && G.player.onFoot) {
      const pp = G.player.position;
      const ox = pp.x - px;
      const oz = pp.z - pz;
      const d2 = ox * ox + oz * oz;
      if (d2 < 36) {
        const dot = (ox * fx + oz * fz) / Math.max(0.001, Math.sqrt(d2));
        if (dot > 0.75) return true;
      }
    }
    // And for pedestrians crossing ahead.
    for (let i = 0; i < pedestrians.length; i++) {
      const ped = pedestrians[i];
      if (ped.state === 'down') continue;
      const ox = ped.group.position.x - px;
      const oz = ped.group.position.z - pz;
      const d2 = ox * ox + oz * oz;
      if (d2 > 49) continue;
      const dot = (ox * fx + oz * fz) / Math.max(0.001, Math.sqrt(d2));
      if (dot > 0.75) return true;
    }
    return false;
  }

  function respawnTrafficCar(ai) {
    const pp = playerPos();
    // Find a road point 120-180 units from the player.
    let best = null;
    for (let tries = 0; tries < 14; tries++) {
      const p = cityRoadPoint();
      const dx = p.x - pp.x;
      const dz = p.z - pp.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= 120 && d <= 180) { best = p; break; }
      if (!best) best = p;
    }
    // Snap to the nearest intersection and pick a fresh direction.
    let ix = 0;
    let iz = 0;
    let bd = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const d = Math.abs(centers[i] - best.x);
      if (d < bd) { bd = d; ix = i; }
    }
    bd = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const d = Math.abs(centers[i] - best.z);
      if (d < bd) { bd = d; iz = i; }
    }
    const dirs = [];
    if (ix > 0) dirs.push({ dx: -1, dz: 0 });
    if (ix < last) dirs.push({ dx: 1, dz: 0 });
    if (iz > 0) dirs.push({ dx: 0, dz: -1 });
    if (iz < last) dirs.push({ dx: 0, dz: 1 });
    const dir = dirs[Math.floor(rng() * dirs.length)];
    const r = rightOf(dir.dx, dir.dz);
    ai.car.group.position.set(centers[ix] + r.x * LANE_OFFSET, 0, centers[iz] + r.z * LANE_OFFSET);
    ai.car.heading = Math.atan2(dir.dx, dir.dz);
    ai.car.group.rotation.y = ai.car.heading;
    ai.car.speed = 0;
    ai.ix = ix;
    ai.iz = iz;
    ai.dir = dir;
    pickNextWaypoint(ai);
  }

  function updateTrafficCar(ai, dt) {
    const car = ai.car;
    const pos = car.group.position;
    const pp = playerPos();

    // Too far from the action: relocate closer to the player.
    const pdx = pos.x - pp.x;
    const pdz = pos.z - pp.z;
    if (pdx * pdx + pdz * pdz > RESPAWN_DIST * RESPAWN_DIST) {
      respawnTrafficCar(ai);
      return;
    }

    // Steer toward the waypoint.
    const wx = ai.waypoint.x - pos.x;
    const wz = ai.waypoint.z - pos.z;
    const distWp = Math.sqrt(wx * wx + wz * wz);
    if (distWp < 5) {
      pickNextWaypoint(ai);
    }
    const desired = Math.atan2(wx, wz);
    const err = angleDelta(desired, car.heading);
    const step = Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, err));
    car.heading += step;
    car.group.rotation.y = car.heading;

    // Speed: cruise, slower in sharp turns, brake for obstacles.
    let target = ai.cruise;
    if (Math.abs(err) > 0.6) target *= 0.55;
    const blocked = obstacleAhead(ai);
    if (blocked) target = 0;
    car.braking = blocked;
    if (car.speed < target) {
      car.speed = Math.min(target, car.speed + 7 * dt);
    } else {
      car.speed = Math.max(target, car.speed - 20 * dt);
    }

    pos.x += Math.sin(car.heading) * car.speed * dt;
    pos.z += Math.cos(car.heading) * car.speed * dt;
    if (G.city && typeof G.city.collideCircle === 'function') {
      G.city.collideCircle(pos, 1.6);
    }
  }

  // ---- Pedestrians ----

  function makePedModel() {
    const group = new THREE.Group();
    const shirt = SHIRTS[Math.floor(rng() * SHIRTS.length)];
    const body = new THREE.Mesh(pedBodyGeo, shirtMaterial(shirt));
    body.position.y = 0.78;
    body.castShadow = true;
    group.add(body);
    const head = new THREE.Mesh(pedHeadGeo, pedSkinMat);
    head.position.y = 1.42;
    head.castShadow = true;
    group.add(head);
    const hair = new THREE.Mesh(pedHairGeo, pedHairMat);
    hair.position.y = 1.45;
    group.add(hair);
    return group;
  }

  function spawnPedestrian() {
    const group = makePedModel();
    const start = citySidewalkPoint();
    group.position.set(start.x, 0, start.z);
    G.scene.add(group);
    const ped = {
      group,
      heading: rng() * Math.PI * 2,
      speed: 1.2 + rng() * 0.8,
      target: citySidewalkPoint(),
      state: 'walk', // 'walk' | 'flee' | 'down'
      fleeUntil: 0,
      downUntil: 0,
      phase: rng() * Math.PI * 2,
    };
    group.rotation.y = ped.heading;
    pedestrians.push(ped);
    return ped;
  }

  function knockDownPed(ped, now) {
    ped.state = 'down';
    ped.downUntil = now + DOWN_TIME;
    // Non-graphic fall: the figure tips over and stays still.
    ped.group.rotation.z = Math.PI / 2;
    ped.group.position.y = 0.22;
    if (G.police && typeof G.police.addHeat === 'function') {
      G.police.addHeat(1);
    }
    const pos = ped.group.position;
    if (G.effects && typeof G.effects.pickupBurst === 'function') {
      G.effects.pickupBurst(pos);
    } else if (G.effects && typeof G.effects.sparks === 'function') {
      G.effects.sparks(pos);
    }
  }

  function revivePed(ped) {
    const spot = citySidewalkPoint();
    ped.group.position.set(spot.x, 0, spot.z);
    ped.group.rotation.set(0, ped.heading, 0);
    ped.target = citySidewalkPoint();
    ped.state = 'walk';
  }

  function updatePedestrian(ped, dt, now) {
    const pos = ped.group.position;
    const pp = playerPos();

    if (ped.state === 'down') {
      if (now >= ped.downUntil) revivePed(ped);
      return;
    }

    // Hit by the player's car at speed?
    const playerCar = G.vehicles ? G.vehicles.getPlayerCar() : null;
    if (playerCar && Math.abs(playerCar.speed) > HIT_SPEED) {
      const dx = pos.x - playerCar.group.position.x;
      const dz = pos.z - playerCar.group.position.z;
      if (dx * dx + dz * dz < HIT_DIST * HIT_DIST) {
        knockDownPed(ped, now);
        return;
      }
    }

    // Flee triggers: a recent gunshot, or a serious wanted level.
    const recentShot = G.combat && typeof G.combat.shotsFiredAt === 'number'
      && (now - G.combat.shotsFiredAt) < 2;
    const highWanted = G.police && G.police.wanted >= 2;
    if ((recentShot || highWanted) && ped.state !== 'flee') {
      ped.state = 'flee';
      ped.fleeUntil = now + FLEE_TIME;
    }
    if (ped.state === 'flee' && now >= ped.fleeUntil && !highWanted) {
      ped.state = 'walk';
      ped.target = citySidewalkPoint();
    }

    if (ped.state === 'flee') {
      // Run directly away from the player.
      _away.set(pos.x - pp.x, 0, pos.z - pp.z);
      if (_away.lengthSq() < 0.01) _away.set(1, 0, 0);
      _away.normalize();
      const desired = Math.atan2(_away.x, _away.z);
      ped.heading += angleDelta(desired, ped.heading) * Math.min(1, 8 * dt);
      pos.x += _away.x * FLEE_SPEED * dt;
      pos.z += _away.z * FLEE_SPEED * dt;
      ped.phase += dt * 14;
    } else {
      // Stroll toward the next sidewalk point.
      const tx = ped.target.x - pos.x;
      const tz = ped.target.z - pos.z;
      const d = Math.sqrt(tx * tx + tz * tz);
      if (d < 1.2) {
        ped.target = citySidewalkPoint();
      } else {
        const desired = Math.atan2(tx, tz);
        ped.heading += angleDelta(desired, ped.heading) * Math.min(1, 6 * dt);
        pos.x += Math.sin(ped.heading) * ped.speed * dt;
        pos.z += Math.cos(ped.heading) * ped.speed * dt;
        ped.phase += dt * (4 + ped.speed * 2);
      }
    }

    if (G.city && typeof G.city.collideCircle === 'function') {
      G.city.collideCircle(pos, 0.4);
    }
    pos.y = Math.abs(Math.sin(ped.phase)) * 0.05;
    ped.group.rotation.y = ped.heading;
  }

  // ---- Spawn the initial population ----
  for (let i = 0; i < TRAFFIC_COUNT; i++) spawnTrafficCar();
  for (let i = 0; i < PED_COUNT; i++) spawnPedestrian();
  counts.cars = trafficCars.length;
  counts.peds = pedestrians.length;

  function update(dt) {
    if (G.state !== 'playing') return;
    const now = G.time || 0;
    for (let i = 0; i < trafficCars.length; i++) {
      updateTrafficCar(trafficCars[i], dt);
    }
    for (let i = 0; i < pedestrians.length; i++) {
      updatePedestrian(pedestrians[i], dt, now);
    }
    counts.cars = trafficCars.length;
    counts.peds = pedestrians.length;
  }

  G.traffic = traffic;
  return traffic;
}
