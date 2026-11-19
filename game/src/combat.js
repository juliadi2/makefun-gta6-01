// combat.js — on-foot shooting and rival enemies for SOLMAR HEAT (gta6-01).
// Original code written for this project. All names are original; nothing here
// comes from Rockstar or any commercial game. No graphic content: hits throw
// sparks, enemies burst into light when defeated — no blood.

import * as THREE from 'three';
import { TUNING } from './config.js';

const CENTER = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
const tmpDir = new THREE.Vector3();
const tmpMuzzle = new THREE.Vector3();
const tmpFrom = new THREE.Vector3();
const tmpTo = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();

// Enemy parts: shared geometries and materials, built once for the whole game.
const torsoGeo = new THREE.BoxGeometry(0.62, 0.78, 0.34);
const headGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
const bandanaGeo = new THREE.BoxGeometry(0.38, 0.12, 0.38);
const legGeo = new THREE.BoxGeometry(0.22, 0.72, 0.24);
legGeo.translate(0, -0.36, 0); // pivot at the hip for the walk swing
const armGeo = new THREE.BoxGeometry(0.16, 0.6, 0.2);
armGeo.translate(0, -0.3, 0); // pivot at the shoulder
const gunGeo = new THREE.BoxGeometry(0.08, 0.12, 0.4);

const torsoMat = new THREE.MeshStandardMaterial({ color: 0x26262e, roughness: 0.85 });
const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1b1b22, roughness: 0.9 });
const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9976b, roughness: 0.8 });
const bandanaMat = new THREE.MeshStandardMaterial({ color: 0xc22424, roughness: 0.7 });
const gunMat = new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.4, metalness: 0.6 });

// Health bar sprites share materials; scale is per-sprite, so one pair of
// materials serves every enemy. depthWrite off + renderOrder keeps the fill
// drawn on top of the background.
const barBgMat = new THREE.SpriteMaterial({ color: 0x1c1c1c, depthWrite: false, transparent: true });
const barFgMat = new THREE.SpriteMaterial({ color: 0x3ddc55, depthWrite: false, transparent: true });

function buildEnemyMesh() {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(torsoGeo, torsoMat);
  torso.position.y = 1.12;
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.y = 1.7;
  const bandana = new THREE.Mesh(bandanaGeo, bandanaMat);
  bandana.position.y = 1.86;
  const legL = new THREE.Mesh(legGeo, pantsMat);
  legL.position.set(-0.14, 0.74, 0);
  const legR = new THREE.Mesh(legGeo, pantsMat);
  legR.position.set(0.14, 0.74, 0);
  const armL = new THREE.Mesh(armGeo, torsoMat);
  armL.position.set(-0.4, 1.46, 0);
  const armR = new THREE.Mesh(armGeo, torsoMat);
  armR.position.set(0.4, 1.46, 0);
  armR.rotation.x = -1.2; // gun arm raised forward
  const gun = new THREE.Mesh(gunGeo, gunMat);
  gun.position.set(0.4, 1.35, 0.35);
  const barBg = new THREE.Sprite(barBgMat);
  barBg.scale.set(1.1, 0.14, 1);
  barBg.position.y = 2.2;
  barBg.renderOrder = 5;
  const barFg = new THREE.Sprite(barFgMat);
  barFg.scale.set(1.04, 0.09, 1);
  barFg.position.y = 2.2;
  barFg.renderOrder = 6;
  g.add(torso, head, bandana, legL, legR, armL, armR, gun, barBg, barFg);
  return { group: g, legL, legR, barFg };
}

export function createCombat(G) {
  function spawnEnemy(x, z, opts = {}) {
    const parts = buildEnemyMesh();
    const health = opts.health || 60;
    const enemy = {
      group: parts.group,
      legL: parts.legL,
      legR: parts.legR,
      barFg: parts.barFg,
      health,
      maxHealth: health,
      shootTimer: 1 + Math.random(),
      phase: Math.random() * Math.PI * 2,
    };
    parts.group.userData.enemy = enemy;
    parts.group.position.set(x, 0, z);
    G.scene.add(parts.group);
    combat.enemies.push(enemy);
    return enemy;
  }

  function clearEnemies() {
    for (const e of combat.enemies) G.scene.remove(e.group);
    combat.enemies.length = 0;
  }

  function killEnemy(enemy) {
    const i = combat.enemies.indexOf(enemy);
    if (i >= 0) combat.enemies.splice(i, 1);
    G.scene.remove(enemy.group);
    G.cash = (G.cash || 0) + 50;
    if (G.effects) G.effects.pickupBurst(enemy.group.position);
    if (G.audio) G.audio.pickup();
    if (G.hud) G.hud.showMessage('+$50', 1.2);
  }

  function damageEnemy(enemy, dmg, point) {
    enemy.health -= dmg;
    if (G.effects) G.effects.sparks(point);
    const frac = Math.max(0, enemy.health / enemy.maxHealth);
    enemy.barFg.scale.x = 1.04 * frac;
    if (enemy.health <= 0) killEnemy(enemy);
  }

  // One shot from the player's gun. Called from update() while the left mouse
  // button is held; also safe to call directly (cooldown + state are checked).
  function shoot() {
    if (G.state !== 'playing') return;
    if (!G.player.onFoot) return;
    if (combat.gunCooldown > 0) return;
    combat.gunCooldown = TUNING.gunCooldown || 0.22;
    combat.shotsFiredAt = G.time;
    if (G.audio) G.audio.gunshot();

    G.camera.getWorldDirection(tmpDir);
    tmpMuzzle.copy(G.player.position);
    tmpMuzzle.y += 1.45;
    tmpMuzzle.x += tmpDir.x * 0.6;
    tmpMuzzle.z += tmpDir.z * 0.6;
    if (G.effects) G.effects.muzzle(tmpMuzzle, tmpDir);

    raycaster.setFromCamera(CENTER, G.camera);
    raycaster.far = TUNING.gunRange || 90;

    const targets = [];
    if (G.city && G.city.group) targets.push(G.city.group);
    for (const e of combat.enemies) targets.push(e.group);
    if (G.traffic && Array.isArray(G.traffic.pedestrians)) {
      for (const p of G.traffic.pedestrians) {
        const g = p.group || p;
        if (g && g.isObject3D) {
          g.userData.ped = true;
          targets.push(g);
        }
      }
    }
    if (G.vehicles && Array.isArray(G.vehicles.cars)) {
      for (const c of G.vehicles.cars) {
        if (c && c.group) targets.push(c.group);
      }
    }
    const hits = raycaster.intersectObjects(targets, true);
    if (!hits.length) return;
    const hit = hits[0];

    // Walk up from the hit mesh to find what was actually shot.
    let obj = hit.object;
    let enemy = null;
    let pedGroup = null;
    while (obj) {
      if (obj.userData.enemy) {
        enemy = obj.userData.enemy;
        break;
      }
      if (obj.userData.ped) {
        pedGroup = obj;
        break;
      }
      obj = obj.parent;
    }

    if (enemy) {
      damageEnemy(enemy, TUNING.gunDamage || 34, hit.point);
    } else if (pedGroup) {
      // Hitting a pedestrian draws heat — once per pedestrian.
      if (!pedGroup.userData.shotByPlayer) {
        pedGroup.userData.shotByPlayer = true;
        if (G.police) G.police.addHeat(1);
      }
      if (G.effects) G.effects.sparks(hit.point);
    } else {
      // Building, ground, or car: sparks at the impact point.
      if (G.effects) G.effects.sparks(hit.point);
    }
  }

  function enemyShoot(e, targetPos) {
    tmpFrom.copy(e.group.position);
    tmpFrom.y = 1.35;
    tmpFrom.x += Math.sin(e.group.rotation.y) * 0.5;
    tmpFrom.z += Math.cos(e.group.rotation.y) * 0.5;
    tmpTo.copy(targetPos);
    tmpTo.y = 1.2;
    const hit = Math.random() < 0.35;
    if (!hit) {
      tmpTo.x += (Math.random() - 0.5) * 5;
      tmpTo.y += (Math.random() - 0.5) * 2;
      tmpTo.z += (Math.random() - 0.5) * 5;
    }
    tmpDir.copy(tmpTo).sub(tmpFrom).normalize();
    if (G.effects) {
      G.effects.muzzle(tmpFrom, tmpDir);
      if (G.effects.tracer) G.effects.tracer(tmpFrom, tmpTo);
    }
    if (G.audio) G.audio.gunshot();
    combat.shotsFiredAt = G.time;
    if (hit) {
      const dmg = 8 + Math.random() * 6;
      if (G.player.takeDamage) G.player.takeDamage(dmg);
      if (G.effects) G.effects.damageFlash();
    }
  }

  function updateEnemy(e, dt) {
    const pos = e.group.position;
    if (G.player.vehicle) tmpTarget.copy(G.player.vehicle.group.position);
    else tmpTarget.copy(G.player.position);
    const dx = tmpTarget.x - pos.x;
    const dz = tmpTarget.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 40 && dist > 0.01) {
      e.group.rotation.y = Math.atan2(dx, dz);
      if (dist > 12) {
        // Close in on the player.
        pos.x += (dx / dist) * 3.5 * dt;
        pos.z += (dz / dist) * 3.5 * dt;
        e.phase += dt * 9;
        const s = Math.sin(e.phase) * 0.55;
        e.legL.rotation.x = s;
        e.legR.rotation.x = -s;
      } else {
        // In range: hold position and shoot (only at a player on foot).
        e.legL.rotation.x *= 0.8;
        e.legR.rotation.x *= 0.8;
        if (G.player.onFoot) {
          e.shootTimer -= dt;
          if (e.shootTimer <= 0) {
            e.shootTimer = 1.2 + Math.random() * 0.8;
            enemyShoot(e, tmpTarget);
          }
        }
      }
      if (G.city) G.city.collideCircle(pos, 0.5);
    }
    // Keep enemies from stacking on top of each other.
    for (const o of combat.enemies) {
      if (o === e) continue;
      const ox = pos.x - o.group.position.x;
      const oz = pos.z - o.group.position.z;
      const od = Math.hypot(ox, oz);
      if (od > 0.01 && od < 1.2) {
        const push = (1.2 - od) * 0.5;
        pos.x += (ox / od) * push;
        pos.z += (oz / od) * push;
      }
    }
  }

  function update(dt) {
    if (G.state !== 'playing') return;
    if (combat.gunCooldown > 0) combat.gunCooldown -= dt;
    if (G.input && G.input.mouseDown) shoot();
    for (let i = combat.enemies.length - 1; i >= 0; i--) {
      updateEnemy(combat.enemies[i], dt);
    }
    if (G.player.health <= 0) {
      G.state = 'dead';
    }
  }

  const combat = {
    enemies: [],
    shotsFiredAt: -100,
    ammo: Infinity,
    gunCooldown: 0,
    update,
    shoot,
    spawnEnemy,
    clearEnemies,
  };
  return combat;
}
