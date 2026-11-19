// SOLMAR HEAT — procedural city: Solmar City.
// Builds the whole city deterministically from RNG_SEED: roads, buildings with
// canvas facade textures, sidewalks, lamps, trees, beach + water, sun + fog.
// Exports only createCity(scene), which returns the interface in design.md.

import * as THREE from 'three';
import { CITY, PALETTE, RNG_SEED, mulberry32 } from './config.js';

const SPAN = CITY.ROAD_CENTERS[CITY.ROAD_CENTERS.length - 1] + CITY.ROAD / 2; // 247
const BLOCK_CENTERS = [];
for (let i = 0; i < CITY.BLOCKS; i++) {
  BLOCK_CENTERS.push(CITY.ROAD_CENTERS[i] + CITY.STEP / 2);
}
// The southernmost block row (z center 210) is beach, not buildings.
const BEACH_ROW = CITY.BLOCKS - 1;

function hexToCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

// Canvas facade: a base wall tint with a grid of lit/unlit windows.
function makeFacadeTexture(baseHex, cols, rows, rng) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = hexToCss(baseHex);
  ctx.fillRect(0, 0, 128, 256);
  // Faint vertical grime variation so flat walls read less flat.
  for (let i = 0; i < 24; i++) {
    const shade = rng() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
    ctx.fillStyle = shade;
    ctx.fillRect(Math.floor(rng() * 128), 0, 4 + Math.floor(rng() * 10), 256);
  }
  const marginX = 10;
  const marginY = 12;
  const gapX = 6;
  const gapY = 8;
  const winW = (128 - marginX * 2 - gapX * (cols - 1)) / cols;
  const winH = (256 - marginY * 2 - gapY * (rows - 1)) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = marginX + c * (winW + gapX);
      const y = marginY + r * (winH + gapY);
      const lit = rng() < 0.28;
      ctx.fillStyle = lit ? '#ffd98a' : '#2a3542';
      ctx.fillRect(x, y, winW, winH);
      if (lit) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(x, y, winW, winH * 0.3);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCity(scene) {
  const rng = mulberry32(RNG_SEED);
  const group = new THREE.Group();
  scene.add(group);

  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.sky, 220, 780);

  // ---- Lights: one shadow-casting sun + hemisphere fill ----
  const hemi = new THREE.HemisphereLight(PALETTE.sky, PALETTE.ground, 0.85);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.4);
  sun.position.set(150, 230, 90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -280;
  sun.shadow.camera.right = 280;
  sun.shadow.camera.top = 280;
  sun.shadow.camera.bottom = -280;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0005;
  group.add(sun);
  group.add(sun.target);

  // ---- Ground base (extends past the city, under the water) ----
  const groundMat = new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 100);
  ground.receiveShadow = true;
  group.add(ground);

  // ---- Road strips (shared geometries + one material) ----
  const roadMat = new THREE.MeshStandardMaterial({ color: PALETTE.road, roughness: 0.95 });
  const roadGeoX = new THREE.BoxGeometry(SPAN * 2, 0.04, CITY.ROAD);
  const roadGeoZ = new THREE.BoxGeometry(CITY.ROAD, 0.04, SPAN * 2);
  for (const c of CITY.ROAD_CENTERS) {
    const rx = new THREE.Mesh(roadGeoX, roadMat);
    rx.position.set(0, 0.02, c);
    rx.receiveShadow = true;
    group.add(rx);
    const rz = new THREE.Mesh(roadGeoZ, roadMat);
    rz.position.set(c, 0.02, 0);
    rz.receiveShadow = true;
    group.add(rz);
  }

  // ---- Sidewalk pads (one instanced box per block) + beach pads ----
  const padGeo = new THREE.BoxGeometry(1, 1, 1);
  const padMat = new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, roughness: 1 });
  const sandMat = new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 1 });
  const blockCount = CITY.BLOCKS * CITY.BLOCKS;
  const beachCount = CITY.BLOCKS;
  const pads = new THREE.InstancedMesh(padGeo, padMat, blockCount - beachCount);
  const beachPads = new THREE.InstancedMesh(padGeo, sandMat, beachCount);
  pads.receiveShadow = true;
  beachPads.receiveShadow = true;
  const dummy = new THREE.Object3D();
  let padIndex = 0;
  let beachIndex = 0;
  for (let ix = 0; ix < CITY.BLOCKS; ix++) {
    for (let iz = 0; iz < CITY.BLOCKS; iz++) {
      const bx = BLOCK_CENTERS[ix];
      const bz = BLOCK_CENTERS[iz];
      dummy.position.set(bx, 0.075, bz);
      dummy.scale.set(CITY.BLOCK, 0.15, CITY.BLOCK);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      if (iz === BEACH_ROW) {
        beachPads.setMatrixAt(beachIndex++, dummy.matrix);
      } else {
        pads.setMatrixAt(padIndex++, dummy.matrix);
      }
    }
  }
  pads.instanceMatrix.needsUpdate = true;
  beachPads.instanceMatrix.needsUpdate = true;
  group.add(pads);
  group.add(beachPads);

  // ---- Sand strip between the beachfront road and the sea ----
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(560, 28), sandMat);
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, 0.03, SPAN + 14);
  strip.receiveShadow = true;
  group.add(strip);

  // ---- Water plane south of the city (animated in update) ----
  const waterMat = new THREE.MeshStandardMaterial({
    color: PALETTE.water,
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(800, 232), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.06, SPAN + 28 + 116);
  group.add(water);

  // ---- Facade materials: 3 window densities, picked by building height ----
  const facadeMats = [];
  const facadeVariants = [
    { cols: 4, rows: 5 },
    { cols: 5, rows: 9 },
    { cols: 6, rows: 14 },
  ];
  for (let i = 0; i < facadeVariants.length; i++) {
    const base = PALETTE.buildings[i % PALETTE.buildings.length];
    const tex = makeFacadeTexture(base, facadeVariants[i].cols, facadeVariants[i].rows, rng);
    facadeMats.push(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  }
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 1 });

  // ---- Buildings: one per non-beach block, taller toward downtown ----
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const buildingBoxes = [];
  for (let ix = 0; ix < CITY.BLOCKS; ix++) {
    for (let iz = 0; iz < CITY.BLOCKS; iz++) {
      if (iz === BEACH_ROW) continue;
      const bx = BLOCK_CENTERS[ix];
      const bz = BLOCK_CENTERS[iz];
      const w = 20 + rng() * 18;
      const d = 20 + rng() * 18;
      const distCenter = Math.sqrt(bx * bx + bz * bz);
      let h = 8 + rng() * 20;
      if (distCenter < 130) h += (1 - distCenter / 130) * 14;
      h = Math.min(42, h);
      const jx = (rng() - 0.5) * 4;
      const jz = (rng() - 0.5) * 4;
      const x = bx + jx;
      const z = bz + jz;
      const facade = h < 16 ? facadeMats[0] : h < 28 ? facadeMats[1] : facadeMats[2];
      const building = new THREE.Mesh(unitBox, [facade, facade, roofMat, roofMat, facade, facade]);
      building.scale.set(w, h, d);
      building.position.set(x, 0.15 + h / 2, z);
      building.castShadow = true;
      building.receiveShadow = true;
      group.add(building);
      buildingBoxes.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minZ: z - d / 2,
        maxZ: z + d / 2,
        height: h,
      });
      // Rooftop box (AC unit / penthouse) on some buildings.
      if (rng() < 0.45) {
        const rw = w * (0.25 + rng() * 0.2);
        const rd = d * (0.25 + rng() * 0.2);
        const rh = 1.5 + rng() * 1.5;
        const roof = new THREE.Mesh(unitBox, roofMat);
        roof.scale.set(rw, rh, rd);
        roof.position.set(x + (rng() - 0.5) * w * 0.3, 0.15 + h + rh / 2, z + (rng() - 0.5) * d * 0.3);
        roof.castShadow = true;
        group.add(roof);
      }
    }
  }

  // ---- Street lamps: one per intersection, instanced pole + head ----
  const intersections = [];
  for (const cx of CITY.ROAD_CENTERS) {
    for (const cz of CITY.ROAD_CENTERS) {
      intersections.push({ x: cx + 8.5, z: cz + 8.5 });
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.6, metalness: 0.4 });
  const headGeo = new THREE.SphereGeometry(0.35, 8, 6);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff6c9,
    emissive: 0xffdf8a,
    emissiveIntensity: 0.9,
  });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, intersections.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, intersections.length);
  intersections.forEach((p, i) => {
    dummy.position.set(p.x, 0.15 + 2.5, p.z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, 0.15 + 5.2, p.z);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
  });
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  group.add(poles);
  group.add(heads);

  // ---- Trees on sidewalks, instanced trunk + canopy ----
  const treeSpots = [];
  for (let ix = 0; ix < CITY.BLOCKS; ix++) {
    for (let iz = 0; iz < CITY.BLOCKS; iz++) {
      if (iz === BEACH_ROW) continue;
      const bx = BLOCK_CENTERS[ix];
      const bz = BLOCK_CENTERS[iz];
      const count = 2 + Math.floor(rng() * 2);
      for (let t = 0; t < count; t++) {
        const edge = Math.floor(rng() * 4);
        const along = -19 + rng() * 38;
        const inset = 1.5 + rng() * 1.5;
        const half = CITY.BLOCK / 2;
        let x = bx;
        let z = bz;
        if (edge === 0) { x = bx + along; z = bz - half + inset; }
        else if (edge === 1) { x = bx + along; z = bz + half - inset; }
        else if (edge === 2) { x = bx - half + inset; z = bz + along; }
        else { x = bx + half - inset; z = bz + along; }
        treeSpots.push({ x, z, s: 0.8 + rng() * 0.5 });
      }
    }
  }
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.6, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
  const canopyGeo = new THREE.ConeGeometry(1.6, 3.4, 7);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x3e7a3a, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeSpots.length);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeSpots.length);
  trunks.castShadow = true;
  canopies.castShadow = true;
  treeSpots.forEach((t, i) => {
    dummy.position.set(t.x, 0.15 + 0.8 * t.s, t.z);
    dummy.scale.set(t.s, t.s, t.s);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(t.x, 0.15 + (1.6 + 1.7) * t.s, t.z);
    dummy.updateMatrix();
    canopies.setMatrixAt(i, dummy.matrix);
  });
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  group.add(trunks);
  group.add(canopies);

  // ---- Palms on the beach blocks + sand strip (individual groups, they sway) ----
  const palmTrunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 4.5, 6);
  const palmTrunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 1 });
  const palmTopGeo = new THREE.ConeGeometry(2.2, 2.4, 7);
  const palmTopMat = new THREE.MeshStandardMaterial({ color: 0x2f7a34, roughness: 1 });
  const palms = [];
  function addPalm(x, z, baseY) {
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(palmTrunkGeo, palmTrunkMat);
    trunk.position.y = 2.25;
    trunk.rotation.z = (rng() - 0.5) * 0.16;
    trunk.castShadow = true;
    palm.add(trunk);
    const top = new THREE.Mesh(palmTopGeo, palmTopMat);
    top.position.y = 4.9;
    top.castShadow = true;
    palm.add(top);
    palm.position.set(x, baseY, z);
    palm.rotation.y = rng() * Math.PI * 2;
    group.add(palm);
    palms.push({ top, phase: rng() * Math.PI * 2 });
  }
  for (let ix = 0; ix < CITY.BLOCKS; ix++) {
    const bx = BLOCK_CENTERS[ix];
    const bz = BLOCK_CENTERS[BEACH_ROW];
    for (let p = 0; p < 2; p++) {
      addPalm(bx + (rng() - 0.5) * 36, bz + (rng() - 0.5) * 36, 0.15);
    }
  }
  for (let p = 0; p < 6; p++) {
    addPalm(-240 + rng() * 480, SPAN + 4 + rng() * 20, 0.03);
  }

  // ---- Dashed center lines, one instanced mesh (gaps at intersections) ----
  const dashGeo = new THREE.PlaneGeometry(4, 0.35);
  dashGeo.rotateX(-Math.PI / 2);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf5f2e8 });
  const dashSpots = [];
  function nearCrossing(v) {
    for (const c of CITY.ROAD_CENTERS) {
      if (Math.abs(v - c) < 11) return true;
    }
    return false;
  }
  for (const c of CITY.ROAD_CENTERS) {
    for (let v = -240; v <= 240; v += 8) {
      if (!nearCrossing(v)) dashSpots.push({ x: v, z: c, rotY: 0 });
      if (!nearCrossing(v)) dashSpots.push({ x: c, z: v, rotY: Math.PI / 2 });
    }
  }
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashSpots.length);
  dashSpots.forEach((d, i) => {
    dummy.position.set(d.x, 0.06, d.z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, d.rotY, 0);
    dummy.updateMatrix();
    dashes.setMatrixAt(i, dummy.matrix);
  });
  dashes.instanceMatrix.needsUpdate = true;
  group.add(dashes);

  // ---- Crosswalks at a few intersections, one instanced mesh ----
  const crossCenters = [
    { x: -120, z: -60 },
    { x: 0, z: 0 },
    { x: 60, z: 120 },
    { x: -60, z: 180 },
    { x: 120, z: -120 },
    { x: 180, z: 60 },
  ];
  const barGeo = new THREE.PlaneGeometry(1, 1);
  barGeo.rotateX(-Math.PI / 2);
  const barMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const barSpots = [];
  for (const cc of crossCenters) {
    for (let i = 0; i < 6; i++) {
      const off = (i - 2.5) * 2.4;
      barSpots.push({ x: cc.x + off, z: cc.z, sx: 1.2, sz: 11 });
      barSpots.push({ x: cc.x, z: cc.z + off, sx: 11, sz: 1.2 });
    }
  }
  const bars = new THREE.InstancedMesh(barGeo, barMat, barSpots.length);
  barSpots.forEach((b, i) => {
    dummy.position.set(b.x, 0.06, b.z);
    dummy.scale.set(b.sx, 1, b.sz);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    bars.setMatrixAt(i, dummy.matrix);
  });
  bars.instanceMatrix.needsUpdate = true;
  group.add(bars);

  // ---- Collision + road helpers ----
  const bounds = { min: -SPAN, max: SPAN };

  function collideCircle(pos, radius) {
    let pushed = false;
    for (const b of buildingBoxes) {
      const nx = Math.max(b.minX, Math.min(pos.x, b.maxX));
      const nz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      const dx = pos.x - nx;
      const dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = radius - d;
        pos.x += (dx / d) * push;
        pos.z += (dz / d) * push;
      } else {
        // Center inside the box: push out along the smallest penetration axis.
        const pl = pos.x - b.minX;
        const pr = b.maxX - pos.x;
        const pn = pos.z - b.minZ;
        const pf = b.maxZ - pos.z;
        const m = Math.min(pl, pr, pn, pf);
        if (m === pl) pos.x = b.minX - radius;
        else if (m === pr) pos.x = b.maxX + radius;
        else if (m === pn) pos.z = b.minZ - radius;
        else pos.z = b.maxZ + radius;
      }
      pushed = true;
    }
    const lo = -CITY.BOUND + radius;
    const hi = CITY.BOUND - radius;
    if (pos.x < lo) { pos.x = lo; pushed = true; }
    if (pos.x > hi) { pos.x = hi; pushed = true; }
    if (pos.z < lo) { pos.z = lo; pushed = true; }
    if (pos.z > hi) { pos.z = hi; pushed = true; }
    return pushed;
  }

  function isOnRoad(x, z) {
    const half = CITY.ROAD / 2;
    for (const c of CITY.ROAD_CENTERS) {
      if (Math.abs(x - c) <= half || Math.abs(z - c) <= half) return true;
    }
    return false;
  }

  function nearestRoadPoint(x, z) {
    let bx = CITY.ROAD_CENTERS[0];
    let bz = CITY.ROAD_CENTERS[0];
    for (const c of CITY.ROAD_CENTERS) {
      if (Math.abs(x - c) < Math.abs(x - bx)) bx = c;
      if (Math.abs(z - c) < Math.abs(z - bz)) bz = c;
    }
    if (Math.abs(x - bx) <= Math.abs(z - bz)) return { x: bx, z };
    return { x, z: bz };
  }

  function randomRoadPoint(rngFn) {
    const c = CITY.ROAD_CENTERS[Math.floor(rngFn() * CITY.ROAD_CENTERS.length)];
    const along = -CITY.BOUND + rngFn() * (2 * CITY.BOUND);
    if (rngFn() < 0.5) return { x: c, z: along };
    return { x: along, z: c };
  }

  function randomSidewalkPoint(rngFn) {
    const ix = Math.floor(rngFn() * CITY.BLOCKS);
    const iz = Math.floor(rngFn() * (CITY.BLOCKS - 1)); // exclude the beach row
    const bx = BLOCK_CENTERS[ix];
    const bz = BLOCK_CENTERS[iz];
    const edge = Math.floor(rngFn() * 4);
    const along = -20 + rngFn() * 40;
    const inset = 1.2 + rngFn() * 1.8;
    const half = CITY.BLOCK / 2;
    if (edge === 0) return { x: bx + along, z: bz - half + inset };
    if (edge === 1) return { x: bx + along, z: bz + half - inset };
    if (edge === 2) return { x: bx - half + inset, z: bz + along };
    return { x: bx + half - inset, z: bz + along };
  }

  // ---- Cheap ambient animation: water shimmer + palm sway ----
  let time = 0;
  function update(dt) {
    time += dt;
    waterMat.opacity = 0.82 + Math.sin(time * 0.7) * 0.06;
    for (const p of palms) {
      p.top.rotation.z = Math.sin(time * 0.8 + p.phase) * 0.06;
    }
  }

  return {
    group,
    bounds,
    buildingBoxes,
    collideCircle,
    isOnRoad,
    nearestRoadPoint,
    randomRoadPoint,
    randomSidewalkPoint,
    roadCenters: CITY.ROAD_CENTERS,
    update,
  };
}
