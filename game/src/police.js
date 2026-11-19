// police.js — wanted system and cop-car pursuit for SOLMAR HEAT (gta6-01).
// Original code written for this project. All names are original; nothing here
// comes from Rockstar or any commercial game.
//
// Convention (shared with the rest of the game): a heading of 0 faces +Z
// (south), PI/2 faces +X (east). Forward = (sin(heading), 0, cos(heading)),
// and a vehicle's group.rotation.y equals its heading.

import * as THREE from 'three';
import { TUNING } from './config.js';

// Lucky's Auto Paint — drive the player car into the zone to clear heat.
const PAINT_SHOP_POS = { x: -180, z: 120 };
const PAINT_SHOP_RADIUS = 10;
const PAINT_COST = 150;

const FALLBACK_CENTERS = [-240, -180, -120, -60, 0, 60, 120, 180, 240];
const MAX_COPS = 3;
const BUST_DIST = 6;
const BUST_STILL_TIME = 2.5;
const ESCAPE_DIST = 55;
const COP_RESPAWN_DIST = 280;
const SPAWN_MIN_DIST = 60;
const SPAWN_MAX_DIST = 95;
const FLASH_PERIOD = 0.4;

// Shared light-bar resources. The two lamp materials are shared by every cop
// car, so the whole fleet flashes in sync and costs no extra materials.
const barBaseGeo = new THREE.BoxGeometry(0.95, 0.1, 0.34);
const barBaseMat = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.6 });
const lampGeo = new THREE.BoxGeometry(0.42, 0.16, 0.3);
const redLampMat = new THREE.MeshStandardMaterial({
  color: 0x330000, emissive: 0xff2020, emissiveIntensity: 0.15,
});
const blueLampMat = new THREE.MeshStandardMaterial({
  color: 0x000033, emissive: 0x2040ff, emissiveIntensity: 0.15,
});

function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnToward(cur, target, maxStep) {
  const d = angDiff(cur, target);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

export function createPolice(G) {
  const roadCenters = (G.city && G.city.roadCenters) || FALLBACK_CENTERS;
  const bound = (G.city && G.city.bounds) ? G.city.bounds.max - 3 : 244;

  let sirenOn = false;
  let flashTimer = 0;
  let flashPhase = false;
  let spawnTimer = 1; // first cop spawns immediately once wanted
  let hiddenTimer = 0;
  let bustTimer = 0;
  let wasInPaintZone = false;

  const tmpP = new THREE.Vector3();

  function nearestCenter(v) {
    let best = roadCenters[0];
    let bestD = Math.abs(v - best);
    for (let i = 1; i < roadCenters.length; i++) {
      const d = Math.abs(v - roadCenters[i]);
      if (d < bestD) {
        bestD = d;
        best = roadCenters[i];
      }
    }
    return best;
  }

  function playerPos(out) {
    if (G.player.vehicle) return out.copy(G.player.vehicle.group.position);
    return out.copy(G.player.position);
  }

  function distToPlayer(car) {
    const p = car.group.position;
    return Math.hypot(p.x - tmpP.x, p.z - tmpP.z);
  }

  function attachLightBar(group) {
    const base = new THREE.Mesh(barBaseGeo, barBaseMat);
    base.position.set(0, 1.3, -0.1);
    const red = new THREE.Mesh(lampGeo, redLampMat);
    red.position.set(-0.24, 1.41, -0.1);
    const blue = new THREE.Mesh(lampGeo, blueLampMat);
    blue.position.set(0.24, 1.41, -0.1);
    group.add(base, red, blue);
  }

  function findSpawnPoint() {
    playerPos(tmpP);
    for (let i = 0; i < 14; i++) {
      const p = G.city.randomRoadPoint(Math.random);
      const d = Math.hypot(p.x - tmpP.x, p.z - tmpP.z);
      if (d >= SPAWN_MIN_DIST && d <= SPAWN_MAX_DIST) return p;
    }
    // Fallback: the nearest road point roughly 75 units east of the player.
    return G.city.nearestRoadPoint(tmpP.x + 75, tmpP.z);
  }

  function spawnCop() {
    const p = findSpawnPoint();
    playerPos(tmpP);
    const heading = Math.atan2(tmpP.x - p.x, tmpP.z - p.z);
    const car = G.vehicles.spawnCar('police', p.x, p.z, heading, 'police');
    if (!car) return;
    // The model already carries a light bar (car.lightBar); only attach one
    // when it does not, so the roof never shows two bars.
    if (!car.lightBar) attachLightBar(car.group);
    const dx = tmpP.x - p.x;
    const dz = tmpP.z - p.z;
    car.policeAI = {
      axis: Math.abs(dx) >= Math.abs(dz) ? 'x' : 'z',
      dir: 1,
      reversing: 0,
      stuckTime: 0,
      checkX: p.x,
      checkZ: p.z,
      checkTimer: 0,
      ramCd: 0,
    };
    const ai = car.policeAI;
    ai.dir = ai.axis === 'x' ? (dx >= 0 ? 1 : -1) : (dz >= 0 ? 1 : -1);
    police.copCars.push(car);
  }

  function removeCop(car) {
    const i = police.copCars.indexOf(car);
    if (i >= 0) police.copCars.splice(i, 1);
    if (G.vehicles && Array.isArray(G.vehicles.cars)) {
      const j = G.vehicles.cars.indexOf(car);
      if (j >= 0) G.vehicles.cars.splice(j, 1);
    }
    G.scene.remove(car.group);
  }

  function addHeat(n) {
    const before = police.wanted;
    police.wanted = Math.max(0, Math.min(5, police.wanted + n));
    if (police.wanted > before) {
      hiddenTimer = 0;
      if (G.audio) G.audio.wantedUp();
    }
  }

  function clearWanted() {
    police.wanted = 0;
    hiddenTimer = 0;
    bustTimer = 0;
    while (police.copCars.length) removeCop(police.copCars[0]);
  }

  function updateCop(car, dt) {
    // Lazily initialise pursuit state: cops spawned outside spawnCop
    // (e.g. staged for a screenshot) arrive without policeAI.
    let ai = car.policeAI;
    if (!ai) {
      ai = car.policeAI = {
        axis: 'x', dir: 1, reversing: 0, stuckTime: 0,
        checkX: car.group.position.x, checkZ: car.group.position.z,
        checkTimer: 0, ramCd: 0,
      };
    }
    const pos = car.group.position;
    playerPos(tmpP);
    const dx = tmpP.x - pos.x;
    const dz = tmpP.z - pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const onFoot = G.player.onFoot;
    const topSpeed = TUNING.policeTopSpeed || 46;

    // Greedy road driving: pick an axis at intersections, keep it mid-block.
    const cx = nearestCenter(pos.x);
    const cz = nearestCenter(pos.z);
    const nearX = Math.abs(pos.x - cx) < 5; // on a north-south road
    const nearZ = Math.abs(pos.z - cz) < 5; // on an east-west road
    const atIntersection = nearX && nearZ;
    const onRoad = G.city.isOnRoad(pos.x, pos.z);

    if (atIntersection && ai.reversing <= 0) {
      if (Math.abs(dx) >= Math.abs(dz)) {
        ai.axis = 'x';
        ai.dir = dx >= 0 ? 1 : -1;
      } else {
        ai.axis = 'z';
        ai.dir = dz >= 0 ? 1 : -1;
      }
    }
    // Never drive off the edge of the city: turn back toward the center.
    if (ai.axis === 'x' && ((pos.x > bound - 10 && ai.dir > 0) || (pos.x < -bound + 10 && ai.dir < 0))) {
      ai.dir = -ai.dir;
    }
    if (ai.axis === 'z' && ((pos.z > bound - 10 && ai.dir > 0) || (pos.z < -bound + 10 && ai.dir < 0))) {
      ai.dir = -ai.dir;
    }

    let desired;
    if (ai.reversing > 0) {
      desired = car.heading; // hold heading, drive backwards to unstick
    } else if (!onRoad) {
      const rp = G.city.nearestRoadPoint(pos.x, pos.z);
      desired = Math.atan2(rp.x - pos.x, rp.z - pos.z);
      if (dist < 14) desired = Math.atan2(dx, dz);
    } else if (dist < 16 && !onFoot) {
      desired = Math.atan2(dx, dz); // close pursuit: steer straight at the car
    } else if (ai.axis === 'x') {
      desired = ai.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      desired = ai.dir > 0 ? 0 : Math.PI;
    }
    car.heading = turnToward(car.heading, desired, 2.4 * dt);
    car.group.rotation.y = car.heading;

    // Speed: chase fast, but pull up and stop next to a player on foot.
    let targetSpeed = topSpeed;
    if (onFoot) {
      if (dist < 7) targetSpeed = 0;
      else if (dist < 16) targetSpeed = Math.min(topSpeed, dist * 1.2);
    }
    if (ai.reversing > 0) {
      ai.reversing -= dt;
      targetSpeed = -9;
    }
    const rate = targetSpeed > car.speed ? 13 : 30;
    if (car.speed < targetSpeed) {
      car.speed = Math.min(targetSpeed, car.speed + rate * dt);
    } else {
      car.speed = Math.max(targetSpeed, car.speed - rate * dt);
    }

    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    pos.x += fx * car.speed * dt;
    pos.z += fz * car.speed * dt;
    if (G.city.collideCircle(pos, 1.6)) car.speed *= 0.55;
    pos.x = Math.max(-bound, Math.min(bound, pos.x));
    pos.z = Math.max(-bound, Math.min(bound, pos.z));

    // Stuck detection: throttle open but barely moving for ~1s -> reverse out.
    ai.checkTimer += dt;
    if (ai.checkTimer >= 1.0) {
      const moved = Math.hypot(pos.x - ai.checkX, pos.z - ai.checkZ);
      if (Math.abs(car.speed) > 4 && moved < 1.2) {
        ai.stuckTime += 1;
        if (ai.stuckTime >= 1.2 && ai.reversing <= 0) {
          ai.reversing = 0.9;
          ai.stuckTime = 0;
          ai.axis = ai.axis === 'x' ? 'z' : 'x';
        }
      } else {
        ai.stuckTime = 0;
      }
      ai.checkX = pos.x;
      ai.checkZ = pos.z;
      ai.checkTimer = 0;
    }

    // Keep cop cars from stacking on top of each other.
    for (const other of police.copCars) {
      if (other === car) continue;
      const op = other.group.position;
      const ox = pos.x - op.x;
      const oz = pos.z - op.z;
      const od = Math.hypot(ox, oz);
      if (od > 0.01 && od < 4) {
        const push = (4 - od) * 0.3;
        pos.x += (ox / od) * push;
        pos.z += (oz / od) * push;
      }
    }

    // Ram: on contact with the player car, shove it and slow it down.
    ai.ramCd -= dt;
    if (!onFoot && dist < 3.6 && ai.ramCd <= 0) {
      const pcar = G.player.vehicle;
      if (pcar) {
        const nx = dx / dist;
        const nz = dz / dist;
        pcar.group.position.x += nx * 1.1;
        pcar.group.position.z += nz * 1.1;
        pcar.speed = Math.max(0, (pcar.speed || 0) - 5);
        G.city.collideCircle(pcar.group.position, 1.6);
        car.speed *= 0.65;
        if (G.effects) G.effects.shake(0.3);
        ai.ramCd = 0.6;
      }
    }
  }

  function update(dt) {
    // Siren follows wanted + state even outside play (so it stops on bust).
    const wantSiren = G.state === 'playing' && police.wanted >= 1;
    if (wantSiren !== sirenOn) {
      sirenOn = wantSiren;
      if (G.audio) G.audio.siren(wantSiren);
    }
    if (G.state !== 'playing') return;

    // Light bar: alternate red/blue every 0.4s while wanted.
    flashTimer += dt;
    if (flashTimer >= FLASH_PERIOD) {
      flashTimer = 0;
      flashPhase = !flashPhase;
      const on = police.wanted >= 1;
      redLampMat.emissiveIntensity = on && flashPhase ? 2.4 : 0.15;
      blueLampMat.emissiveIntensity = on && !flashPhase ? 2.4 : 0.15;
      // Flash each cop car model that carries its own light bar, too.
      for (const car of police.copCars) {
        if (!car.lightBar) continue;
        car.lightBar.red.emissiveIntensity = on && flashPhase ? 2.4 : 0.15;
        car.lightBar.blue.emissiveIntensity = on && !flashPhase ? 2.4 : 0.15;
      }
    }

    // Safety net: no heat means no cops on the street.
    if (police.wanted === 0 && police.copCars.length) {
      while (police.copCars.length) removeCop(police.copCars[0]);
    }

    // Maintain min(wanted, 3) cop cars.
    const target = Math.min(police.wanted, MAX_COPS);
    if (police.copCars.length > target) {
      playerPos(tmpP);
      const sorted = police.copCars.slice().sort((a, b) => distToPlayer(b) - distToPlayer(a));
      while (police.copCars.length > target) removeCop(sorted.shift());
    }
    spawnTimer += dt;
    if (police.copCars.length < target && spawnTimer >= 0.6) {
      spawnTimer = 0;
      spawnCop();
    }

    // Drive the fleet; track the nearest cop for escape + bust logic.
    playerPos(tmpP);
    let nearestCop = Infinity;
    for (let i = police.copCars.length - 1; i >= 0; i--) {
      const car = police.copCars[i];
      updateCop(car, dt);
      const d = Math.hypot(
        car.group.position.x - tmpP.x,
        car.group.position.z - tmpP.z,
      );
      if (d < nearestCop) nearestCop = d;
      // A cop that somehow ends up far away re-deploys near the player.
      if (d > COP_RESPAWN_DIST) {
        const p = findSpawnPoint();
        car.group.position.set(p.x, 0, p.z);
        car.heading = Math.atan2(tmpP.x - p.x, tmpP.z - p.z);
        car.group.rotation.y = car.heading;
        car.speed = 10;
      }
    }

    // Escape: no cop within 55 for 6s (wanted 1-2) / 10s (wanted 3+) sheds a star.
    if (police.wanted > 0) {
      if (nearestCop > ESCAPE_DIST) {
        hiddenTimer += dt;
        const need = police.wanted <= 2 ? 6 : 10;
        if (hiddenTimer >= need) {
          hiddenTimer = 0;
          police.wanted -= 1;
          if (police.wanted === 0) {
            while (police.copCars.length) removeCop(police.copCars[0]);
            if (G.hud) G.hud.showMessage('You lost them.', 2.5);
          }
        }
      } else {
        hiddenTimer = 0;
      }
    }

    // Bust: on foot, standing still, with a stopped cop car right beside you.
    if (police.wanted >= 1 && G.player.onFoot) {
      const still = (G.player.speed || 0) < 1;
      let copCloseStopped = false;
      if (still) {
        for (const car of police.copCars) {
          const cp = car.group.position;
          if (
            Math.hypot(cp.x - tmpP.x, cp.z - tmpP.z) < BUST_DIST &&
            Math.abs(car.speed) < 3
          ) {
            copCloseStopped = true;
            break;
          }
        }
      }
      if (copCloseStopped) {
        bustTimer += dt;
        if (bustTimer >= BUST_STILL_TIME) {
          bustTimer = 0;
          G.state = 'busted';
          if (G.audio) G.audio.busted();
          return;
        }
      } else {
        bustTimer = 0;
      }
    } else {
      bustTimer = 0;
    }

    // Lucky's Auto Paint: drive into the zone to clear wanted for $150.
    if (!G.player.onFoot && G.player.vehicle) {
      const vp = G.player.vehicle.group.position;
      const dShop = Math.hypot(vp.x - PAINT_SHOP_POS.x, vp.z - PAINT_SHOP_POS.z);
      const inZone = dShop < PAINT_SHOP_RADIUS;
      if (inZone && !wasInPaintZone && police.wanted > 0) {
        if (G.cash >= PAINT_COST) {
          G.cash -= PAINT_COST;
          clearWanted();
          if (G.hud) G.hud.showMessage('Fresh paint — the heat is off. -$150', 3);
          if (G.audio) G.audio.pickup();
        } else if (G.hud) {
          G.hud.showMessage("Lucky's Auto Paint: $150 — not enough cash", 3);
        }
      }
      wasInPaintZone = inZone;
    } else {
      wasInPaintZone = false;
    }
  }

  const police = {
    wanted: 0,
    copCars: [],
    paintShop: { x: PAINT_SHOP_POS.x, z: PAINT_SHOP_POS.z, radius: PAINT_SHOP_RADIUS },
    addHeat,
    clearWanted,
    update,
  };
  return police;
}
