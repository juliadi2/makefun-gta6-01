// vehicles.js — procedural low-poly cars, the single car registry, and
// arcade driving physics for the player's car.
// Part of SOLMAR HEAT (make.fun gta6-01). All content original.
import * as THREE from 'three';
import { TUNING, PALETTE, CITY, mulberry32, RNG_SEED } from './config.js';

// ---- Shared geometry (one instance each, reused by every car) ----
const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
wheelGeo.rotateZ(Math.PI / 2); // axle along X so rotation.x spins the wheel
const wheelGeoBig = new THREE.CylinderGeometry(0.44, 0.44, 0.32, 12);
wheelGeoBig.rotateZ(Math.PI / 2);
const headGeo = new THREE.BoxGeometry(0.34, 0.18, 0.08);
const tailGeo = new THREE.BoxGeometry(0.3, 0.16, 0.08);
const signGeo = new THREE.BoxGeometry(0.7, 0.22, 0.3);
const barGeo = new THREE.BoxGeometry(1.1, 0.14, 0.3);
const barLightGeo = new THREE.BoxGeometry(0.5, 0.16, 0.32);

// Body / cabin geometry per type (shared across cars of that type).
const BODY = {};
function bodyGeo(w, h, l) {
  const key = `${w}|${h}|${l}`;
  if (!BODY[key]) BODY[key] = new THREE.BoxGeometry(w, h, l);
  return BODY[key];
}

// ---- Shared materials ----
const MAT = {
  glass: new THREE.MeshStandardMaterial({ color: 0x101c26, roughness: 0.25, metalness: 0.6 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }),
  hub: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.7 }),
  head: new THREE.MeshStandardMaterial({ color: 0xfff6c9, emissive: 0xffedb0, emissiveIntensity: 1.4 }),
  sign: new THREE.MeshStandardMaterial({ color: 0xffe14d, emissive: 0xffd21f, emissiveIntensity: 0.7 }),
  barRed: new THREE.MeshStandardMaterial({ color: 0x881111, emissive: 0xff2222, emissiveIntensity: 2 }),
  barBlue: new THREE.MeshStandardMaterial({ color: 0x112288, emissive: 0x2244ff, emissiveIntensity: 2 }),
  barBase: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }),
  bumper: new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.8 }),
};

// Body paint materials, cached per color so cars share them.
const paintCache = new Map();
function paintMaterial(color) {
  const key = color;
  let m = paintCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35 });
    paintCache.set(key, m);
  }
  return m;
}

// Taillight materials are per-car (brake lights change emissive intensity).
function tailMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x881111,
    emissive: 0xff1a1a,
    emissiveIntensity: 0.35,
  });
}

// Dimensions per type: body [w,h,l], cabin [w,h,l], cabin offset y/z,
// wheel radius, wheel y, wheel x/z spread.
const SPECS = {
  sedan: { body: [1.9, 0.62, 4.4], cabin: [1.7, 0.55, 2.2], cabinY: 0.58, cabinZ: -0.15, wheelR: 0.36, wheelY: 0.36, wx: 0.92, wz: 1.45 },
  taxi: { body: [1.9, 0.62, 4.4], cabin: [1.7, 0.55, 2.2], cabinY: 0.58, cabinZ: -0.15, wheelR: 0.36, wheelY: 0.36, wx: 0.92, wz: 1.45 },
  sport: { body: [2.05, 0.5, 4.5], cabin: [1.6, 0.42, 1.9], cabinY: 0.46, cabinZ: -0.3, wheelR: 0.36, wheelY: 0.36, wx: 1.0, wz: 1.5 },
  truck: { body: [2.2, 1.0, 5.6], cabin: [2.0, 0.8, 1.6], cabinY: 0.9, cabinZ: 1.7, wheelR: 0.44, wheelY: 0.44, wx: 1.05, wz: 1.9 },
  van: { body: [2.0, 1.1, 5.0], cabin: [1.9, 0.7, 3.2], cabinY: 0.9, cabinZ: -0.2, wheelR: 0.36, wheelY: 0.36, wx: 0.95, wz: 1.65 },
  police: { body: [1.95, 0.62, 4.5], cabin: [1.7, 0.55, 2.2], cabinY: 0.58, cabinZ: -0.15, wheelR: 0.36, wheelY: 0.36, wx: 0.92, wz: 1.5 },
};

const DEFAULT_COLORS = [0xc0392b, 0x2e6f9e, 0xd8d8d8, 0x333a44, 0x7a4fa3, 0x3f8f5f, 0xd98a2b, 0x9fb3c8];

// Scratch vectors for the physics loop.
const _fwd = new THREE.Vector3();
const _push = new THREE.Vector3();

function addWheel(parent, geo, x, y, z) {
  const wheel = new THREE.Mesh(geo, MAT.tire);
  wheel.position.set(x, y, z);
  wheel.castShadow = true;
  parent.add(wheel);
  return wheel;
}

// Build a procedural low-poly car model. The returned group's userData holds
// { wheels, tailMats, lightBar } for the runtime systems.
export function makeCarModel(type, color) {
  const spec = SPECS[type] || SPECS.sedan;
  const group = new THREE.Group();
  const paint = paintMaterial(type === 'taxi' ? 0xf2c200 : color);

  const [bw, bh, bl] = spec.body;
  const body = new THREE.Mesh(bodyGeo(bw, bh, bl), paint);
  body.position.y = spec.wheelY + bh / 2 - 0.08;
  body.castShadow = true;
  group.add(body);

  const [cw, ch, cl] = spec.cabin;
  const cabin = new THREE.Mesh(bodyGeo(cw, ch, cl), paint);
  cabin.position.set(0, body.position.y + bh / 2 + ch / 2 - 0.06, spec.cabinZ);
  cabin.castShadow = true;
  group.add(cabin);

  // Windshield + rear glass: dark slabs on the cabin faces.
  const shield = new THREE.Mesh(bodyGeo(cw * 0.96, ch * 0.8, 0.08), MAT.glass);
  shield.position.set(0, cabin.position.y, spec.cabinZ + cl / 2 + 0.02);
  group.add(shield);
  const rearGlass = new THREE.Mesh(bodyGeo(cw * 0.96, ch * 0.8, 0.08), MAT.glass);
  rearGlass.position.set(0, cabin.position.y, spec.cabinZ - cl / 2 - 0.02);
  group.add(rearGlass);

  // Headlights (front = +Z) and taillights (rear = -Z).
  const frontZ = bl / 2 + 0.02;
  const rearZ = -bl / 2 - 0.02;
  const lightY = body.position.y;
  const hl = new THREE.Mesh(headGeo, MAT.head);
  hl.position.set(-bw / 2 + 0.3, lightY, frontZ);
  group.add(hl);
  const hr = new THREE.Mesh(headGeo, MAT.head);
  hr.position.set(bw / 2 - 0.3, lightY, frontZ);
  group.add(hr);

  const tailMats = [tailMaterial(), tailMaterial()];
  const tl = new THREE.Mesh(tailGeo, tailMats[0]);
  tl.position.set(-bw / 2 + 0.3, lightY, rearZ);
  group.add(tl);
  const tr = new THREE.Mesh(tailGeo, tailMats[1]);
  tr.position.set(bw / 2 - 0.3, lightY, rearZ);
  group.add(tr);

  // Wheels.
  const wgeo = spec.wheelR > 0.4 ? wheelGeoBig : wheelGeo;
  const wheels = [
    addWheel(group, wgeo, -spec.wx, spec.wheelY, spec.wz),
    addWheel(group, wgeo, spec.wx, spec.wheelY, spec.wz),
    addWheel(group, wgeo, -spec.wx, spec.wheelY, -spec.wz),
    addWheel(group, wgeo, spec.wx, spec.wheelY, -spec.wz),
  ];

  // Type extras.
  let lightBar = null;
  if (type === 'taxi') {
    const sign = new THREE.Mesh(signGeo, MAT.sign);
    sign.position.set(0, cabin.position.y + ch / 2 + 0.12, spec.cabinZ);
    group.add(sign);
  }
  if (type === 'police') {
    // White doors + black hood/trunk read as a patrol car at a glance.
    const doorL = new THREE.Mesh(bodyGeo(0.06, bh * 0.8, cl), paintMaterial(0xf2f2f2));
    doorL.position.set(-bw / 2 - 0.01, body.position.y, spec.cabinZ);
    group.add(doorL);
    const doorR = new THREE.Mesh(bodyGeo(0.06, bh * 0.8, cl), paintMaterial(0xf2f2f2));
    doorR.position.set(bw / 2 + 0.01, body.position.y, spec.cabinZ);
    group.add(doorR);
    const bar = new THREE.Mesh(barGeo, MAT.barBase);
    bar.position.set(0, cabin.position.y + ch / 2 + 0.1, spec.cabinZ);
    group.add(bar);
    const redMat = MAT.barRed.clone();
    const blueMat = MAT.barBlue.clone();
    const red = new THREE.Mesh(barLightGeo, redMat);
    red.position.set(-0.28, cabin.position.y + ch / 2 + 0.12, spec.cabinZ);
    group.add(red);
    const blue = new THREE.Mesh(barLightGeo, blueMat);
    blue.position.set(0.28, cabin.position.y + ch / 2 + 0.12, spec.cabinZ);
    group.add(blue);
    lightBar = { red: redMat, blue: blueMat };
  }
  if (type === 'truck') {
    // Cargo bed walls on the rear half.
    const bedH = 0.5;
    const bed = new THREE.Mesh(bodyGeo(bw - 0.1, bedH, 2.6), paintMaterial(0x5a5f66));
    bed.position.set(0, body.position.y + bh / 2 + bedH / 2 - 0.1, -1.3);
    group.add(bed);
  }

  group.userData.wheels = wheels;
  group.userData.tailMats = tailMats;
  group.userData.lightBar = lightBar;
  group.userData.wheelR = spec.wheelR;
  return group;
}

export function createVehicleSystem(G) {
  const cars = [];
  const rng = mulberry32(RNG_SEED + 11);

  const system = {
    cars,
    makeCarModel,
    spawnCar,
    spawnParkedCars,
    nearestCar,
    update,
    getPlayerCar,
  };

  function spawnCar(type, x, z, heading, driver, colorOverride) {
    const palette = (PALETTE && PALETTE.cars) || DEFAULT_COLORS;
    const color = colorOverride != null
      ? colorOverride
      : type === 'police'
        ? 0x14161a
        : type === 'taxi'
          ? 0xf2c200
          : palette[Math.floor(rng() * palette.length)];
    const group = makeCarModel(type, color);
    group.position.set(x, 0, z);
    group.rotation.y = heading;
    G.scene.add(group);

    const car = {
      group,
      heading,
      speed: 0,
      color,
      type,
      isPolice: type === 'police',
      driver: driver || null,
      braking: false,
      wheels: group.userData.wheels,
      tailMats: group.userData.tailMats,
      lightBar: group.userData.lightBar,
      wheelR: group.userData.wheelR,
      update: updateCarVisual,
      setDriver,
    };
    cars.push(car);
    return car;
  }

  function setDriver(d) {
    this.driver = d;
  }

  // Per-car visual update: wheel spin + brake lights. Runs for every car,
  // whatever system drives it.
  function updateCarVisual(dt) {
    const spin = (this.speed * dt) / Math.max(0.2, this.wheelR);
    for (let i = 0; i < this.wheels.length; i++) {
      this.wheels[i].rotation.x += spin;
    }
    const glow = this.braking ? 2.2 : 0.35;
    for (let i = 0; i < this.tailMats.length; i++) {
      this.tailMats[i].emissiveIntensity = glow;
    }
  }

  function spawnParkedCars(n) {
    const centers = CITY.ROAD_CENTERS;
    let placed = 0;
    let guard = 0;
    while (placed < n && guard++ < n * 12) {
      // Pick a road and a spot along it, parked at the road's edge.
      const alongRoad = rng() < 0.5; // true: road runs along X (varying x)
      const center = centers[Math.floor(rng() * centers.length)];
      const along = (rng() * 2 - 1) * (CITY.BOUND - 20);
      const side = rng() < 0.5 ? -1 : 1;
      const edge = CITY.ROAD / 2 - 1.6; // just inside the road edge
      let x;
      let z;
      let heading;
      if (alongRoad) {
        x = along;
        z = center + side * edge;
        heading = side > 0 ? Math.PI : 0;
      } else {
        x = center + side * edge;
        z = along;
        heading = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      }
      // Keep the spawn area around the player start clear.
      if (Math.abs(x) < 14 && Math.abs(z - 8) < 14) continue;
      // Avoid stacking two parked cars on top of each other.
      let crowded = false;
      for (let i = 0; i < cars.length; i++) {
        const dx = cars[i].group.position.x - x;
        const dz = cars[i].group.position.z - z;
        if (dx * dx + dz * dz < 36) { crowded = true; break; }
      }
      if (crowded) continue;
      const types = ['sedan', 'sedan', 'taxi', 'sport', 'van', 'truck'];
      spawnCar(types[Math.floor(rng() * types.length)], x, z, heading, null);
      placed++;
    }
    return placed;
  }

  function nearestCar(pos, radius, opts) {
    const includePolice = opts && opts.includePolice;
    let best = null;
    let bestD2 = radius * radius;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      if (car.driver === 'player') continue;
      if (car.isPolice && !includePolice) continue;
      const dx = car.group.position.x - pos.x;
      const dz = car.group.position.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = car;
      }
    }
    return best;
  }

  function getPlayerCar() {
    for (let i = 0; i < cars.length; i++) {
      if (cars[i].driver === 'player') return cars[i];
    }
    return null;
  }

  function drivePlayerCar(car, dt) {
    const input = G.input;
    const axis = input.axis();
    const throttle = axis.y; // +1 W, -1 S
    const steer = axis.x; // +1 D (right), -1 A (left)
    const handbrake = input.keys.has('Space');

    car.braking = false;
    if (handbrake) {
      // Handbrake: hard speed cut + skid.
      const cut = 26 * dt;
      if (Math.abs(car.speed) <= cut) car.speed = 0;
      else car.speed -= Math.sign(car.speed) * cut;
      car.braking = true;
      if (Math.abs(car.speed) > 14 && G.effects && typeof G.effects.skid === 'function') {
        G.effects.skid(car.group.position);
      }
    } else if (throttle > 0) {
      car.speed += TUNING.carAccel * throttle * dt;
    } else if (throttle < 0) {
      if (car.speed > 0.5) {
        // S while moving forward = brake.
        car.speed -= TUNING.carBrake * dt;
        if (car.speed < 0) car.speed = 0;
        car.braking = true;
      } else {
        // S while stopped/slow = reverse.
        car.speed += TUNING.carAccel * 0.55 * throttle * dt;
      }
    }

    // Rolling drag + idle drag (stronger when coasting).
    const dragRate = throttle === 0 ? 0.55 : 0.12;
    car.speed -= car.speed * dragRate * dt;
    if (Math.abs(car.speed) < 0.05 && throttle === 0) car.speed = 0;
    if (car.speed > TUNING.carMaxSpeed) car.speed = TUNING.carMaxSpeed;
    if (car.speed < -TUNING.carReverseMax) car.speed = -TUNING.carReverseMax;

    // Steering: effectiveness scales with speed; reverses when reversing.
    const speedFactor = Math.max(-1, Math.min(1, car.speed / TUNING.carMaxSpeed));
    car.heading -= steer * TUNING.steerRate * speedFactor * dt;
    car.group.rotation.y = car.heading;

    _fwd.set(Math.sin(car.heading), 0, Math.cos(car.heading));
    car.group.position.addScaledVector(_fwd, car.speed * dt);

    // Building collision + bounds: a bump scrubs speed.
    if (G.city && typeof G.city.collideCircle === 'function') {
      if (G.city.collideCircle(car.group.position, 1.6)) {
        car.speed *= 0.35;
      }
    }

    // Soft car-car push: shove overlapping cars apart, scrub speed.
    for (let i = 0; i < cars.length; i++) {
      const other = cars[i];
      if (other === car) continue;
      const dx = car.group.position.x - other.group.position.x;
      const dz = car.group.position.z - other.group.position.z;
      const d2 = dx * dx + dz * dz;
      const minD = 3.4;
      if (d2 > 0.0001 && d2 < minD * minD) {
        const d = Math.sqrt(d2);
        const push = (minD - d) * 0.5;
        _push.set(dx / d, 0, dz / d);
        car.group.position.addScaledVector(_push, push);
        other.group.position.addScaledVector(_push, -push);
        car.speed *= 0.92;
        if (other.driver === 'traffic' || other.driver === null) {
          other.speed *= 0.5;
        }
      }
    }

    // Engine hum follows speed.
    if (G.audio && typeof G.audio.engine === 'function') {
      G.audio.engine(Math.abs(car.speed) / TUNING.carMaxSpeed, true);
    }
  }

  function update(dt) {
    if (G.state !== 'playing') {
      if (G.audio && typeof G.audio.engine === 'function') G.audio.engine(0, false);
      return;
    }
    const playerCar = getPlayerCar();
    if (playerCar) drivePlayerCar(playerCar, dt);
    else if (G.audio && typeof G.audio.engine === 'function') {
      G.audio.engine(0, false);
    }
    // Visuals for every registered car (wheel spin, brake lights).
    for (let i = 0; i < cars.length; i++) {
      cars[i].update(dt);
    }
  }

  G.vehicles = system;
  return system;
}
