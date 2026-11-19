// main.js — SOLMAR HEAT boot, game loop, camera, and screens.
//
// Wires every system together through the G object (see design.md), runs the
// frame loop, follows the player with a third-person camera, and owns the
// title / pause / busted / hospital screens. All game content is original.

import * as THREE from 'three';
import { PALETTE } from './config.js';
import { createInput } from './input.js';
import { createCity } from './city.js';
import { createPlayer } from './player.js';
import { createVehicleSystem } from './vehicles.js';
import { createTraffic } from './traffic.js';
import { createPolice } from './police.js';
import { createCombat } from './combat.js';
import { createMissionSystem } from './missions.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createSaveSystem } from './save.js';
import { getShotParams, applyShotSetup } from './shots.js';

const SPAWN = { x: -60, z: -60 }; // downtown intersection
const POLICE_STATION = { x: -60, z: 60 };
const HOSPITAL = { x: 60, z: 60 };
const BAIL_COST = 200;

// ---------- Renderer / scene / camera ----------
const container = document.getElementById('game-container');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1500);

// ---------- Game context + systems ----------
const G = {
  scene,
  camera,
  renderer,
  clock: new THREE.Clock(),
  input: null,
  audio: null,
  city: null,
  player: null,
  vehicles: null,
  traffic: null,
  police: null,
  combat: null,
  missions: null,
  effects: null,
  hud: null,
  save: null,
  state: 'title',
  time: 0,
  cash: 0,
  muted: false,
  shot: null,
};

G.input = createInput();
G.input.attach();
G.audio = createAudio();
G.city = createCity(scene);
G.effects = createEffects(G);
G.vehicles = createVehicleSystem(G);
G.traffic = createTraffic(G);
G.player = createPlayer(G);
G.police = createPolice(G);
G.combat = createCombat(G);
G.missions = createMissionSystem(G);
G.hud = createHud();
G.save = createSaveSystem();

// Parked cars around the city, including a couple near the spawn.
G.vehicles.spawnParkedCars(12);

// ---------- Screens ----------
const screens = {
  start: document.getElementById('start-screen'),
  howto: document.getElementById('howto-screen'),
  pause: document.getElementById('pause-screen'),
  busted: document.getElementById('busted-screen'),
  dead: document.getElementById('dead-screen'),
};
const hudEl = document.getElementById('hud');
const btnContinue = document.getElementById('btn-continue');
const btnMute = document.getElementById('btn-mute');

function showOnly(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle('hidden', key !== name);
  }
  hudEl.classList.toggle('hidden', name !== null);
}

function refreshContinueButton() {
  btnContinue.classList.toggle('hidden', !G.save.hasSave());
}

function startGame(fresh) {
  if (fresh) {
    G.save.clearSave();
    G.cash = 0;
    G.muted = false;
    G.player.position.set(SPAWN.x, 0, SPAWN.z);
    G.player.heading = Math.PI * 0.25;
    G.player.health = 100;
  } else {
    const saved = G.save.load();
    if (saved) {
      G.cash = saved.cash || 0;
      G.muted = !!saved.muted;
      if (Array.isArray(saved.playerPos)) {
        G.player.position.set(saved.playerPos[0], 0, saved.playerPos[1]);
      }
      if (typeof saved.health === 'number') G.player.health = saved.health;
    }
  }
  G.audio.setMuted(G.muted);
  refreshMuteButton();
  G.audio.resume();
  G.state = 'playing';
  showOnly(null);
  G.input.lockPointer(renderer.domElement);
  G.hud.showMessage('SOLMAR HEAT', 2.5);
}

function refreshMuteButton() {
  btnMute.textContent = `Mute: ${G.muted ? 'On' : 'Off'}`;
}

function toggleMute() {
  G.muted = !G.muted;
  G.audio.setMuted(G.muted);
  refreshMuteButton();
}

function pauseGame() {
  if (G.state !== 'playing') return;
  G.state = 'paused';
  G.input.unlockPointer();
  showOnly('pause');
}

function resumeGame() {
  if (G.state !== 'paused') return;
  G.state = 'playing';
  showOnly(null);
  G.input.lockPointer(renderer.domElement);
}

function respawnAt(point, penaltyText) {
  if (G.player.vehicle) G.player.exitVehicle();
  G.player.position.set(point.x, 0, point.z);
  G.player.heading = 0;
  G.player.group.position.copy(G.player.position);
  G.player.health = 100;
  G.police.clearWanted();
  G.combat.clearEnemies();
  G.state = 'playing';
  showOnly(null);
  G.input.lockPointer(renderer.domElement);
  if (penaltyText) G.hud.showMessage(penaltyText, 3);
}

// ---------- Menu wiring ----------
document.getElementById('btn-new').addEventListener('click', () => {
  G.audio.click();
  startGame(true);
});
btnContinue.addEventListener('click', () => {
  G.audio.click();
  startGame(false);
});
document.getElementById('btn-howto').addEventListener('click', () => {
  G.audio.click();
  showOnly('howto');
});
document.getElementById('btn-howto-close').addEventListener('click', () => {
  G.audio.click();
  showOnly('start');
});
document.getElementById('btn-resume').addEventListener('click', () => {
  G.audio.click();
  resumeGame();
});
document.getElementById('btn-save').addEventListener('click', () => {
  const ok = G.save.save(G);
  G.hud.showMessage(ok ? 'Game saved.' : 'Save failed.', 2);
});
btnMute.addEventListener('click', () => toggleMute());
document.getElementById('btn-restart').addEventListener('click', () => {
  G.save.clearSave();
  window.location.reload();
});
document.getElementById('btn-quit').addEventListener('click', () => {
  window.location.reload();
});
document.getElementById('btn-busted').addEventListener('click', () => {
  G.cash = Math.max(0, G.cash - BAIL_COST);
  respawnAt(POLICE_STATION, `Bail paid — $${BAIL_COST}`);
});
document.getElementById('btn-respawn').addEventListener('click', () => {
  const bill = Math.round(G.cash * 0.1);
  G.cash = Math.max(0, G.cash - bill);
  G.missions.failMission('Mara went down');
  respawnAt(HOSPITAL, `Medical bill — $${bill}`);
});
renderer.domElement.addEventListener('click', () => {
  if (G.state === 'playing' && !G.input.locked) {
    G.input.lockPointer(renderer.domElement);
  }
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Camera ----------
let camYaw = Math.PI * 1.25;
let camPitch = 0.32;
let camDist = 7;
let mouseYaw = 0;
let mousePitch = 0;
let titleOrbit = 0;

function updateCamera(dt) {
  const mouse = G.input.consumeMouse();
  if (G.input.locked && (mouse.dx !== 0 || mouse.dy !== 0)) {
    mouseYaw -= mouse.dx * 0.0028;
    mousePitch += mouse.dy * 0.0022;
    mousePitch = Math.max(-0.25, Math.min(0.45, mousePitch));
  } else {
    // No mouse input: ease back to the follow camera.
    mouseYaw *= Math.max(0, 1 - dt * 1.2);
    mousePitch *= Math.max(0, 1 - dt * 1.2);
  }

  let target;
  let desiredYaw;
  let desiredDist;
  if (G.state === 'title') {
    // Slow orbit over the city behind the start screen.
    titleOrbit += dt * 0.05;
    const cx = Math.sin(titleOrbit) * 130;
    const cz = Math.cos(titleOrbit) * 130;
    camera.position.set(cx, 55, cz);
    camera.lookAt(0, 0, -20);
    return;
  }
  if (G.player.vehicle) {
    const car = G.player.vehicle;
    target = car.group.position;
    desiredYaw = car.heading + Math.PI;
    desiredDist = 10.5;
  } else {
    target = G.player.position;
    desiredYaw = G.player.heading + Math.PI;
    desiredDist = 7;
  }
  // Shot framing: front chase camera — the camera glides ahead of the car
  // looking back at it, so pursuing police cars appear in frame behind it.
  if (G.shot && G.shot.front && G.player.vehicle) {
    const heading = G.player.vehicle.heading;
    camera.position.set(
      target.x + Math.sin(heading) * 13,
      target.y + 3.4,
      target.z + Math.cos(heading) * 13,
    );
    camera.lookAt(target.x, target.y + 1.4, target.z);
    return;
  }
  // Shortest-arc follow of the desired yaw, plus the mouse offset.
  let dyaw = desiredYaw + mouseYaw - camYaw;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  camYaw += dyaw * Math.min(1, dt * 4);
  camPitch += ((0.32 + mousePitch) - camPitch) * Math.min(1, dt * 4);
  camDist += (desiredDist - camDist) * Math.min(1, dt * 3);

  const cp = Math.cos(camPitch);
  const off = new THREE.Vector3(
    Math.sin(camYaw) * cp * camDist,
    Math.sin(camPitch) * camDist + 1.2,
    Math.cos(camYaw) * cp * camDist,
  );
  const shakeAmp = G.effects ? G.effects.shakeAmp : 0;
  if (shakeAmp > 0.001) {
    off.x += (Math.random() - 0.5) * shakeAmp;
    off.y += (Math.random() - 0.5) * shakeAmp * 0.6;
    off.z += (Math.random() - 0.5) * shakeAmp;
  }
  camera.position.set(target.x + off.x, target.y + off.y, target.z + off.z);
  camera.lookAt(target.x, target.y + 1.6, target.z);
}

// ---------- Shot mode ----------
const shotParams = getShotParams();
let shotStaged = false;
let framesRendered = 0;

// ---------- Main loop ----------
let lastState = G.state;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(G.clock.getDelta(), 0.05);

  // Global keys.
  if (G.input.pressed('Escape') || G.input.pressed('KeyP')) {
    if (G.state === 'playing') pauseGame();
    else if (G.state === 'paused') resumeGame();
  }
  if (G.input.pressed('KeyM')) toggleMute();
  if (G.input.pressed('KeyH') && G.state === 'playing' && G.player.vehicle) {
    G.audio.horn();
  }

  // Shot mode: auto-start and stage the scene once systems are live.
  if (shotParams.shot && !shotStaged) {
    G.save.clearSave();
    G.cash = 0;
    G.state = 'playing';
    showOnly(null);
    applyShotSetup(G, shotParams.shot);
    shotStaged = true;
  }

  if (G.state === 'playing') {
    G.time += dt;
    G.player.update(dt);
    G.vehicles.update(dt);
    G.traffic.update(dt);
    G.police.update(dt);
    G.combat.update(dt);
    G.missions.update(dt);
    G.effects.update(dt);
  }
  G.city.update(dt);
  updateCamera(dt);
  G.hud.update(G);
  G.input.endFrame();

  // State changes driven by systems (busted / dead) show their screens.
  if (G.state !== lastState) {
    if (G.state === 'busted') {
      G.input.unlockPointer();
      showOnly('busted');
    } else if (G.state === 'dead') {
      G.input.unlockPointer();
      showOnly('dead');
    }
    lastState = G.state;
  }

  renderer.render(scene, camera);
  framesRendered += 1;
  if (shotParams.shot && shotStaged && framesRendered >= 3) {
    window.__solmarReady = true;
  }
}

refreshContinueButton();
showOnly('start');
animate();
