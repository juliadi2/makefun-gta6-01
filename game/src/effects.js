// effects.js — pooled particle effects, skid marks, tracers, camera shake
// for SOLMAR HEAT (gta6-01). Original code written for this project.
//
// Everything is pre-allocated at creation: one THREE.Points pool for all
// particles, one THREE.LineSegments pool for tracers, and a fixed ring of
// skid-mark quads. Spawning an effect writes into ring buffers — no per-frame
// allocation in the hot paths.

import * as THREE from 'three';

const MAX_PARTICLES = 512;
const MAX_SKIDS = 48;
const MAX_TRACERS = 16;
const SKID_FADE_TIME = 6;

const FIRE_COLORS = [
  [1.0, 0.85, 0.3],
  [1.0, 0.55, 0.15],
  [0.95, 0.3, 0.08],
  [1.0, 0.95, 0.6],
];

export function createEffects(G) {
  // ---- Particle pool (one THREE.Points, additive, vertex colors) ----
  const pPos = new Float32Array(MAX_PARTICLES * 3);
  const pCol = new Float32Array(MAX_PARTICLES * 3);
  const pVel = new Float32Array(MAX_PARTICLES * 3);
  const pLife = new Float32Array(MAX_PARTICLES);
  const pMaxLife = new Float32Array(MAX_PARTICLES);
  const pBase = new Float32Array(MAX_PARTICLES * 3);
  for (let i = 0; i < MAX_PARTICLES; i++) {
    pPos[i * 3 + 1] = -999; // park dead particles far below the city
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({
    size: 0.5,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  G.scene.add(points);
  let pCursor = 0;

  function spawnParticle(x, y, z, vx, vy, vz, life, r, g, b) {
    const i = pCursor;
    pCursor = (pCursor + 1) % MAX_PARTICLES;
    const i3 = i * 3;
    pPos[i3] = x;
    pPos[i3 + 1] = y;
    pPos[i3 + 2] = z;
    pVel[i3] = vx;
    pVel[i3 + 1] = vy;
    pVel[i3 + 2] = vz;
    pLife[i] = life;
    pMaxLife[i] = life;
    pBase[i3] = r;
    pBase[i3 + 1] = g;
    pBase[i3 + 2] = b;
    pCol[i3] = r;
    pCol[i3 + 1] = g;
    pCol[i3 + 2] = b;
  }

  // ---- Skid marks (fixed ring of flat dark quads) ----
  const skidGeo = new THREE.PlaneGeometry(0.55, 1.8);
  skidGeo.rotateX(-Math.PI / 2);
  const skids = [];
  for (let i = 0; i < MAX_SKIDS; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x0d0d0d,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const m = new THREE.Mesh(skidGeo, mat);
    m.visible = false;
    m.position.y = 0.02;
    m.renderOrder = 1;
    G.scene.add(m);
    skids.push({ mesh: m, life: 0 });
  }
  let skidCursor = 0;
  const lastSkid = new THREE.Vector3(1e6, 0, 1e6);

  // ---- Tracers (one THREE.LineSegments pool) ----
  const tPos = new Float32Array(MAX_TRACERS * 6);
  const tCol = new Float32Array(MAX_TRACERS * 6);
  const tLife = new Float32Array(MAX_TRACERS);
  const tMaxLife = new Float32Array(MAX_TRACERS);
  for (let i = 0; i < MAX_TRACERS; i++) {
    tPos[i * 6 + 1] = -999;
    tPos[i * 6 + 4] = -999;
  }
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  const tMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const tracers = new THREE.LineSegments(tGeo, tMat);
  tracers.frustumCulled = false;
  G.scene.add(tracers);
  let tCursor = 0;

  function explosion(pos) {
    for (let n = 0; n < 70; n++) {
      const a = Math.random() * Math.PI * 2;
      const up = (Math.random() - 0.25) * 2;
      const sp = 4 + Math.random() * 11;
      const c = FIRE_COLORS[(Math.random() * FIRE_COLORS.length) | 0];
      spawnParticle(
        pos.x, pos.y + 0.4, pos.z,
        Math.cos(a) * sp, up * sp * 0.7 + 2, Math.sin(a) * sp,
        0.5 + Math.random() * 0.6, c[0], c[1], c[2],
      );
    }
    shake(0.5);
    if (G.audio) G.audio.explosion();
  }

  function muzzle(pos, dir) {
    for (let n = 0; n < 10; n++) {
      const sp = 7 + Math.random() * 9;
      spawnParticle(
        pos.x, pos.y, pos.z,
        dir.x * sp + (Math.random() - 0.5) * 3,
        dir.y * sp + (Math.random() - 0.5) * 3,
        dir.z * sp + (Math.random() - 0.5) * 3,
        0.08 + Math.random() * 0.08,
        1.0, 0.85 + Math.random() * 0.15, 0.35,
      );
    }
  }

  function sparks(pos) {
    for (let n = 0; n < 12; n++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 6;
      spawnParticle(
        pos.x, pos.y, pos.z,
        Math.cos(a) * sp, 1 + Math.random() * 5, Math.sin(a) * sp,
        0.25 + Math.random() * 0.25,
        1.0, 0.85 + Math.random() * 0.15, 0.5,
      );
    }
  }

  function pickupBurst(pos) {
    for (let n = 0; n < 26; n++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 4;
      const gold = Math.random() < 0.5;
      spawnParticle(
        pos.x, pos.y + 0.6, pos.z,
        Math.cos(a) * sp, 2.5 + Math.random() * 4, Math.sin(a) * sp,
        0.5 + Math.random() * 0.4,
        gold ? 1.0 : 0.3, gold ? 0.85 : 1.0, gold ? 0.3 : 0.45,
      );
    }
  }

  function skid(pos) {
    // Don't stack marks on the same spot when called every frame.
    if (Math.hypot(pos.x - lastSkid.x, pos.z - lastSkid.z) < 0.9) return;
    lastSkid.copy(pos);
    const s = skids[skidCursor];
    skidCursor = (skidCursor + 1) % MAX_SKIDS;
    let heading = 0;
    if (G.player.vehicle) heading = G.player.vehicle.heading || 0;
    else if (G.player) heading = G.player.heading || 0;
    s.mesh.position.set(pos.x, 0.02, pos.z);
    s.mesh.rotation.y = heading;
    s.mesh.visible = true;
    s.mesh.material.opacity = 0.55;
    s.life = SKID_FADE_TIME;
  }

  // Extra: a short-lived tracer line for enemy gunfire (used by combat.js).
  // Values are copied into the pool immediately, so temp vectors are safe.
  function tracer(from, to) {
    const i = tCursor;
    tCursor = (tCursor + 1) % MAX_TRACERS;
    const i6 = i * 6;
    tPos[i6] = from.x;
    tPos[i6 + 1] = from.y;
    tPos[i6 + 2] = from.z;
    tPos[i6 + 3] = to.x;
    tPos[i6 + 4] = to.y;
    tPos[i6 + 5] = to.z;
    tCol[i6] = 1;
    tCol[i6 + 1] = 0.9;
    tCol[i6 + 2] = 0.45;
    tCol[i6 + 3] = 1;
    tCol[i6 + 4] = 0.9;
    tCol[i6 + 5] = 0.45;
    tLife[i] = 0.12;
    tMaxLife[i] = 0.12;
  }

  function shake(amount) {
    effects.shakeAmp = Math.min(1.2, effects.shakeAmp + amount);
  }

  function damageFlash() {
    if (G.hud && typeof G.hud.flashDamage === 'function') G.hud.flashDamage();
  }

  function update(dt) {
    if (G.state === 'paused') return;

    if (effects.shakeAmp > 0) {
      effects.shakeAmp *= Math.max(0, 1 - dt * 3.2);
      if (effects.shakeAmp < 0.005) effects.shakeAmp = 0;
    }

    let anyAlive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (pLife[i] <= 0) continue;
      anyAlive = true;
      pLife[i] -= dt;
      const i3 = i * 3;
      if (pLife[i] <= 0) {
        pPos[i3 + 1] = -999;
        pCol[i3] = 0;
        pCol[i3 + 1] = 0;
        pCol[i3 + 2] = 0;
        continue;
      }
      pVel[i3 + 1] -= 7 * dt;
      const drag = Math.max(0, 1 - 1.6 * dt);
      pVel[i3] *= drag;
      pVel[i3 + 1] *= drag;
      pVel[i3 + 2] *= drag;
      pPos[i3] += pVel[i3] * dt;
      pPos[i3 + 1] += pVel[i3 + 1] * dt;
      pPos[i3 + 2] += pVel[i3 + 2] * dt;
      if (pPos[i3 + 1] < 0.05) {
        pPos[i3 + 1] = 0.05;
        pVel[i3 + 1] *= -0.3;
      }
      // Additive blending: fading the color toward black fades the particle out.
      const f = pLife[i] / pMaxLife[i];
      pCol[i3] = pBase[i3] * f;
      pCol[i3 + 1] = pBase[i3 + 1] * f;
      pCol[i3 + 2] = pBase[i3 + 2] * f;
    }
    if (anyAlive) {
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;
    }

    for (const s of skids) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        s.mesh.material.opacity = 0;
      } else {
        s.mesh.material.opacity = 0.55 * (s.life / SKID_FADE_TIME);
      }
    }

    let anyTracer = false;
    for (let i = 0; i < MAX_TRACERS; i++) {
      if (tLife[i] <= 0) continue;
      anyTracer = true;
      tLife[i] -= dt;
      const i6 = i * 6;
      if (tLife[i] <= 0) {
        tPos[i6 + 1] = -999;
        tPos[i6 + 4] = -999;
        tCol[i6] = 0;
        tCol[i6 + 1] = 0;
        tCol[i6 + 2] = 0;
        tCol[i6 + 3] = 0;
        tCol[i6 + 4] = 0;
        tCol[i6 + 5] = 0;
      } else {
        const f = tLife[i] / tMaxLife[i];
        tCol[i6] = f;
        tCol[i6 + 1] = 0.9 * f;
        tCol[i6 + 2] = 0.45 * f;
        tCol[i6 + 3] = f;
        tCol[i6 + 4] = 0.9 * f;
        tCol[i6 + 5] = 0.45 * f;
      }
    }
    if (anyTracer) {
      tGeo.attributes.position.needsUpdate = true;
      tGeo.attributes.color.needsUpdate = true;
    }
  }

  const effects = {
    shakeAmp: 0,
    update,
    explosion,
    muzzle,
    sparks,
    skid,
    pickupBurst,
    tracer,
    shake,
    damageFlash,
  };
  return effects;
}
