// player.js — Mara Voss, third-person on-foot character + vehicle entry.
// Part of SOLMAR HEAT (make.fun gta6-01). All content original.
import * as THREE from 'three';
import { TUNING } from './config.js';

// Shared geometry / materials for the character model (built once).
// Limb geometry is translated so each mesh origin sits at its joint
// (shoulder / hip), letting rotation.x swing it naturally.
const armGeo = new THREE.BoxGeometry(0.16, 0.72, 0.18);
armGeo.translate(0, -0.36, 0);
const legGeo = new THREE.BoxGeometry(0.2, 0.8, 0.22);
legGeo.translate(0, -0.4, 0);

const GEO = {
  torso: new THREE.BoxGeometry(0.62, 0.78, 0.34),
  head: new THREE.BoxGeometry(0.34, 0.36, 0.32),
  hair: new THREE.BoxGeometry(0.38, 0.14, 0.36),
  arm: armGeo,
  leg: legGeo,
  shoe: new THREE.BoxGeometry(0.22, 0.12, 0.34),
};

const MAT = {
  jacket: new THREE.MeshStandardMaterial({ color: 0x2e6f5e, roughness: 0.85 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xc98d64, roughness: 0.7 }),
  hair: new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.9 }),
  pants: new THREE.MeshStandardMaterial({ color: 0x2b3242, roughness: 0.9 }),
  shoe: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }),
};

const GRAVITY = 24;
const JUMP_SPEED = 8.5;
const ENTER_RADIUS = 4.2;
const BAIL_SPEED = 10;
const BAIL_DAMAGE = 10;

// Reused scratch vectors (no per-frame allocation in the hot path).
const _camDir = new THREE.Vector3();
const _move = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _exitPos = new THREE.Vector3();

function buildCharacterModel() {
  const group = new THREE.Group();

  const torso = new THREE.Mesh(GEO.torso, MAT.jacket);
  torso.position.y = 1.18;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(GEO.head, MAT.skin);
  head.position.y = 1.78;
  head.castShadow = true;
  group.add(head);

  const hair = new THREE.Mesh(GEO.hair, MAT.hair);
  hair.position.y = 1.96;
  group.add(hair);

  // Arms pivot at the shoulder, legs at the hip (see translated geometry).
  const armL = new THREE.Mesh(GEO.arm, MAT.jacket);
  armL.position.set(-0.42, 1.5, 0);
  armL.castShadow = true;
  group.add(armL);

  const armR = new THREE.Mesh(GEO.arm, MAT.jacket);
  armR.position.set(0.42, 1.5, 0);
  armR.castShadow = true;
  group.add(armR);

  const legL = new THREE.Mesh(GEO.leg, MAT.pants);
  legL.position.set(-0.16, 0.82, 0);
  legL.castShadow = true;
  group.add(legL);

  const legR = new THREE.Mesh(GEO.leg, MAT.pants);
  legR.position.set(0.16, 0.82, 0);
  legR.castShadow = true;
  group.add(legR);

  // Shoes ride on the legs so they follow the walk swing.
  const shoeL = new THREE.Mesh(GEO.shoe, MAT.shoe);
  shoeL.position.set(0, -0.78, 0.05);
  legL.add(shoeL);

  const shoeR = new THREE.Mesh(GEO.shoe, MAT.shoe);
  shoeR.position.set(0, -0.78, 0.05);
  legR.add(shoeR);

  return { group, armL, armR, legL, legR };
}

// Shortest signed angular difference (target - current) in [-PI, PI].
function angleDelta(target, current) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function createPlayer(G) {
  const model = buildCharacterModel();
  const group = model.group;
  group.position.set(0, 0, 8);
  G.scene.add(group);

  const player = {
    group,
    position: group.position,
    heading: 0,
    health: TUNING.playerHealth,
    onFoot: true,
    vehicle: null,
    speed: 0,
    update,
    enterVehicle,
    exitVehicle,
    takeDamage,
    heal,
    isDead,
    getPosition,
  };

  let vy = 0; // vertical velocity for jumping
  let grounded = true;
  let walkPhase = 0;
  let stolen = new Set(); // cars already counted as stolen (heat once each)

  function getPosition() {
    if (!player.onFoot && player.vehicle) return player.vehicle.group.position;
    return group.position;
  }

  function isDead() {
    return player.health <= 0;
  }

  function takeDamage(n) {
    if (n <= 0 || player.health <= 0) return;
    player.health = Math.max(0, player.health - n);
    if (G.effects && typeof G.effects.damageFlash === 'function') {
      G.effects.damageFlash();
    }
  }

  function heal(n) {
    if (n <= 0) return;
    player.health = Math.min(TUNING.playerHealth, player.health + n);
  }

  function enterVehicle(car) {
    if (!car || !player.onFoot) return false;
    // Stealing a traffic or parked car draws the heat of the law — once.
    const isSteal = car.driver === 'traffic' || car.driver === null;
    if (isSteal && !stolen.has(car) && G.police && typeof G.police.addHeat === 'function') {
      G.police.addHeat(1);
      stolen.add(car);
    }
    car.driver = 'player';
    if (typeof car.setDriver === 'function') car.setDriver('player');
    player.vehicle = car;
    player.onFoot = false;
    group.visible = false;
    group.position.copy(car.group.position);
    if (G.audio && typeof G.audio.click === 'function') G.audio.click();
    return true;
  }

  function exitVehicle() {
    const car = player.vehicle;
    if (!car || player.onFoot) return false;
    const fast = Math.abs(car.speed) > BAIL_SPEED;
    // Step out on the car's left side (driver side).
    const hx = Math.sin(car.heading);
    const hz = Math.cos(car.heading);
    _exitPos.set(
      car.group.position.x + hz * 2.2,
      0,
      car.group.position.z - hx * 2.2,
    );
    if (G.city && typeof G.city.collideCircle === 'function') {
      G.city.collideCircle(_exitPos, 0.5);
    }
    group.position.copy(_exitPos);
    group.position.y = 0;
    player.heading = car.heading;
    group.rotation.y = player.heading;
    car.driver = null;
    if (typeof car.setDriver === 'function') car.setDriver(null);
    player.vehicle = null;
    player.onFoot = true;
    group.visible = true;
    vy = 0;
    grounded = true;
    if (fast) takeDamage(BAIL_DAMAGE); // bailing out at speed hurts
    if (G.audio && typeof G.audio.click === 'function') G.audio.click();
    return true;
  }

  function updateOnFoot(dt) {
    const input = G.input;
    const axis = input.axis();

    // Camera-relative movement: forward is where the camera looks (XZ plane).
    G.camera.getWorldDirection(_camDir);
    _fwd.set(_camDir.x, 0, _camDir.z);
    if (_fwd.lengthSq() < 0.0001) _fwd.set(0, 0, 1);
    _fwd.normalize();
    // Right = forward x up (right-handed): (-fz, 0, fx).
    _right.set(-_fwd.z, 0, _fwd.x);

    _move.set(0, 0, 0);
    _move.addScaledVector(_fwd, axis.y);
    _move.addScaledVector(_right, axis.x);
    const moving = _move.lengthSq() > 0.0001;
    if (moving) _move.normalize();

    const running = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
    const targetSpeed = moving ? (running ? TUNING.runSpeed : TUNING.walkSpeed) : 0;
    // Smooth acceleration / deceleration.
    const accel = moving ? 40 : 30;
    if (player.speed < targetSpeed) {
      player.speed = Math.min(targetSpeed, player.speed + accel * dt);
    } else {
      player.speed = Math.max(targetSpeed, player.speed - accel * dt);
    }

    if (moving && player.speed > 0.1) {
      const targetHeading = Math.atan2(_move.x, _move.z);
      const d = angleDelta(targetHeading, player.heading);
      const turnRate = 12;
      const step = Math.max(-turnRate * dt, Math.min(turnRate * dt, d));
      player.heading += step;
      group.position.x += _move.x * player.speed * dt;
      group.position.z += _move.z * player.speed * dt;
    }
    group.rotation.y = player.heading;

    // Jump: Space tap while grounded.
    if (grounded && input.pressed('Space')) {
      vy = JUMP_SPEED;
      grounded = false;
    }
    if (!grounded) {
      vy -= GRAVITY * dt;
      group.position.y += vy * dt;
      if (group.position.y <= 0) {
        group.position.y = 0;
        vy = 0;
        grounded = true;
      }
    }

    // Building collision + city bounds.
    if (G.city && typeof G.city.collideCircle === 'function') {
      G.city.collideCircle(group.position, 0.5);
    }

    // Walk-cycle swing; legs opposite arms, faster when running.
    if (player.speed > 0.1 && grounded) {
      walkPhase += dt * (4 + player.speed * 1.1);
      const swing = Math.min(0.75, 0.25 + player.speed * 0.05);
      const s = Math.sin(walkPhase) * swing;
      model.legL.rotation.x = s;
      model.legR.rotation.x = -s;
      model.armL.rotation.x = -s * 0.8;
      model.armR.rotation.x = s * 0.8;
    } else if (!grounded) {
      // Airborne pose: legs tucked, arms out.
      model.legL.rotation.x = 0.5;
      model.legR.rotation.x = -0.3;
      model.armL.rotation.x = -0.6;
      model.armR.rotation.x = -0.6;
    } else {
      // Ease back to idle.
      model.legL.rotation.x *= 0.8;
      model.legR.rotation.x *= 0.8;
      model.armL.rotation.x *= 0.8;
      model.armR.rotation.x *= 0.8;
    }

    // E near a car: get in.
    if (input.pressed('KeyE') && G.vehicles) {
      const car = G.vehicles.nearestCar(group.position, ENTER_RADIUS);
      if (car) enterVehicle(car);
    }
  }

  function update(dt) {
    if (G.state !== 'playing') return;
    if (player.onFoot) {
      updateOnFoot(dt);
      return;
    }
    // Driving: the vehicle system owns physics; mirror the car.
    const car = player.vehicle;
    if (!car) {
      player.onFoot = true;
      group.visible = true;
      return;
    }
    player.speed = Math.abs(car.speed);
    player.heading = car.heading;
    group.position.copy(car.group.position);
    group.position.y = 0;
    group.rotation.y = car.heading;
    if (G.input.pressed('KeyE')) exitVehicle();
  }

  G.player = player;
  return player;
}
