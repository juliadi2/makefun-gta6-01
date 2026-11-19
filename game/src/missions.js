// missions.js — SOLMAR HEAT story missions.
//
// A data-driven step state machine: each mission is a list of steps, and a
// step completes when its condition is met. Completing the last step finishes
// the mission: cash reward, subtitle, autosave, and the next mission starts
// after 3 seconds. Mission 0 auto-starts when play begins (or the saved
// mission resumes, when a save exists).
//
// All story, names and dialogue are original. Systems are reached only via
// the G object passed to createMissionSystem(G).

import * as THREE from 'three';
import { NAMES } from './config.js';

// Key city locations (x, z). Roads run on the 60-unit grid, so these sit on
// or next to road centers and are all reachable by car.
const LOC = {
  garage: { x: -120, z: 60 }, // Ivy's garage, Coral Way
  drop: { x: 120, z: -120 }, // Meridian lot drop point
  marina: { x: 180, z: 180 }, // Marina, south-east
  docks: { x: -180, z: 180 }, // Docks, south-west
  briefcase: { x: -150, z: 210 }, // Dockside crate yard
  dante: { x: 60, z: -180 }, // Dante's office, north side
  tower: { x: 0, z: -60 }, // Meridian Tower
  cashRoom: { x: 24, z: -36 }, // Tower cash room, plaza side
  safehouse: { x: -180, z: -180 }, // Safehouse, north-west
};

// Step types:
//   goto      { pos, radius }                    — reach a point (on foot or driving)
//   drive     { pos, radius, spawnCar? }         — reach a point while driving
//   steal     { carType, stealPos, deliverPos }  — get into the spawned target car
//   survive   { seconds, wanted }                — stay alive with the heat on
//   eliminate { count, spawnArea }               — take out the spawned rivals
//   deliver   { pos, radius, car: 'target'? }    — reach a point (in the target car)
//   escape    { pos?, radius? }                  — lose wanted to 0, or reach a safe point
// Optional step fields: say (subtitle line), pickup (burst + sound on
// completion), setWanted (heat level applied when the step completes).
const MISSIONS = [
  {
    title: 'First Run',
    reward: 250,
    intro: `${NAMES.fixer}: Mara. You're back in Solmar. Good — Ivy has a coupe waiting at her garage.`,
    complete: `${NAMES.fixer}: Clean run. That's how we start.`,
    steps: [
      {
        type: 'goto', pos: LOC.garage, radius: 10,
        text: "Go to Ivy's garage",
        say: `${NAMES.fixer}: Ivy's garage, Coral Way. Don't keep her waiting.`,
      },
      {
        type: 'drive', pos: LOC.drop, radius: 10,
        text: 'Drive the coupe to the Meridian lot',
        say: `${NAMES.mechanic}: She's tuned and fueled. Drop her at the Meridian lot — no scratches.`,
        spawnCar: { type: 'sport', at: LOC.garage },
      },
    ],
  },
  {
    title: 'Hot Property',
    reward: 400,
    intro: `${NAMES.fixer}: Hale's crew left a fresh coupe at the marina. Take it — quietly.`,
    complete: `${NAMES.mechanic}: Tracker stripped. She's ours now.`,
    steps: [
      {
        type: 'steal', carType: 'sport', stealPos: LOC.marina, deliverPos: LOC.garage,
        text: 'Steal the coupe at the marina',
        say: `${NAMES.fixer}: The coupe is at the marina. Get in and go.`,
      },
      {
        type: 'deliver', pos: LOC.garage, radius: 10, car: 'target',
        text: "Deliver the coupe to Ivy's garage",
        say: `${NAMES.mechanic}: Bring it to the garage. I'll strip the tracker.`,
      },
    ],
  },
  {
    title: 'Heat Wave',
    reward: 600,
    intro: `${NAMES.fixer}: Hale tipped off the precinct. They're coming for you — ride it out.`,
    complete: `${NAMES.fixer}: They lost you. Nice driving.`,
    steps: [
      {
        type: 'survive', seconds: 90, wanted: 2,
        text: 'Survive the heat',
        say: `${NAMES.fixer}: Ninety seconds. Stay moving, stay loose.`,
      },
      {
        type: 'escape',
        text: 'Lose the cops',
        say: `${NAMES.fixer}: Now shake them. Get clean.`,
      },
    ],
  },
  {
    title: 'Dockside Trouble',
    reward: 800,
    intro: `${NAMES.fixer}: Hale's men grabbed my ledger at the docks. Get it back.`,
    complete: `${NAMES.fixer}: The ledger's safe. Hale won't forget this — neither will I.`,
    steps: [
      {
        type: 'goto', pos: LOC.docks, radius: 12,
        text: 'Go to the docks',
        say: `${NAMES.fixer}: The docks, south side. Watch yourself.`,
      },
      {
        type: 'eliminate', count: 4, spawnArea: LOC.docks,
        text: "Deal with Hale's crew",
        say: `${NAMES.player}: Four of them. Fine — let's settle this.`,
      },
      {
        type: 'goto', pos: LOC.briefcase, radius: 6,
        text: 'Grab the briefcase',
        say: `${NAMES.player}: There's the briefcase.`,
        pickup: true,
      },
      {
        type: 'goto', pos: LOC.dante, radius: 10,
        text: 'Return the ledger to Dante',
        say: `${NAMES.fixer}: Bring it home, Mara.`,
      },
    ],
  },
  {
    title: 'The Meridian Job',
    reward: 1500,
    intro: `${NAMES.fixer}: One last job. Meridian Tower — Hale's cash room. In and out.`,
    complete: `${NAMES.fixer}: We did it, Mara. Solmar is ours tonight.`,
    steps: [
      {
        type: 'goto', pos: LOC.tower, radius: 12,
        text: 'Reach Meridian Tower',
        say: `${NAMES.mechanic}: Lobby's clear. Service stairs on the north side.`,
      },
      {
        type: 'goto', pos: LOC.cashRoom, radius: 6,
        text: 'Grab the cash',
        say: `${NAMES.player}: Got the cash. Time to go.`,
        pickup: true,
        setWanted: 3,
      },
      {
        type: 'escape', pos: LOC.safehouse, radius: 12,
        text: 'Escape to the safehouse',
        say: `${NAMES.fixer}: Every cop in Solmar is on you. Safehouse — now.`,
      },
    ],
  },
];

function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function createMissionSystem(G) {
  // Objective beacon: a tall additive light pillar plus a ground ring,
  // created once and moved to the current marker position.
  let beacon = null;
  let ring = null;
  if (G.scene) {
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0xffd23f, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 36, 12, 1, true), beaconMat);
    beacon.position.y = 18;
    beacon.visible = false;
    G.scene.add(beacon);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd23f, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthWrite: false,
    });
    ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.2, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    ring.visible = false;
    G.scene.add(ring);
  }

  let stepIndex = 0;
  let runtime = {}; // per-mission scratch: targetCar, enemiesBase, timers
  let nextTimer = 0; // delay before the next (or retried) mission starts
  let pendingIndex = -1;
  let autoStartDone = false;
  let beaconT = 0;

  function getPlayerPos() {
    if (G.player && typeof G.player.getPosition === 'function') return G.player.getPosition();
    if (G.player && G.player.position) return G.player.position;
    return null;
  }

  function setMarker(pos) {
    sys.markerPos = pos ? new THREE.Vector3(pos.x, 0, pos.z) : null;
    const show = sys.markerPos !== null;
    if (beacon) {
      beacon.visible = show;
      if (show) beacon.position.set(sys.markerPos.x, 18, sys.markerPos.z);
    }
    if (ring) {
      ring.visible = show;
      if (show) ring.position.set(sys.markerPos.x, 0.15, sys.markerPos.z);
    }
    if (G.hud) G.hud.setBlip(sys.markerPos);
  }

  function setObjectiveText(text) {
    sys.objectiveText = text;
    if (G.hud) G.hud.setObjective(text);
  }

  function say(text, seconds) {
    if (text && G.hud) G.hud.subtitle(text, seconds || 4);
  }

  function beginStep(step) {
    sys.currentStep = step;
    // Step-specific setup.
    if (step.type === 'steal' && G.vehicles) {
      runtime.targetCar = G.vehicles.spawnCar(
        step.carType || 'sport', step.stealPos.x, step.stealPos.z, 0, null,
      ) || null;
    }
    if (step.spawnCar && G.vehicles) {
      // Park the mission car just clear of the player at the spawn point.
      G.vehicles.spawnCar(step.spawnCar.type || 'sport',
        step.spawnCar.at.x + 5, step.spawnCar.at.z, 0, null);
    }
    if (step.type === 'eliminate' && G.combat) {
      runtime.enemiesBase = G.combat.enemies.length;
      runtime.remainingShown = step.count;
      const area = step.spawnArea;
      for (let i = 0; i < step.count; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 6 + Math.random() * 10;
        G.combat.spawnEnemy(area.x + Math.cos(a) * r, area.z + Math.sin(a) * r, {});
      }
    }
    if (step.type === 'survive') {
      runtime.surviveT = step.seconds || 60;
      runtime.surviveShown = -1;
      if (G.police) {
        G.police.clearWanted();
        G.police.addHeat(step.wanted || 2);
      }
    }
    // Marker: the point the player must reach (none for survive / plain escape).
    setMarker(step.pos || step.stealPos || step.spawnArea || null);
    setObjectiveText(`${sys.current.title} — ${step.text}`);
    say(step.say, 5);
  }

  function completeStep() {
    const step = sys.currentStep;
    if (!step || !sys.current) return;
    if (step.pickup) {
      const at = step.pos || getPlayerPos();
      if (at && G.effects) G.effects.pickupBurst(new THREE.Vector3(at.x, 1, at.z));
      if (G.audio) G.audio.pickup();
    }
    if (step.setWanted && G.police) {
      G.police.clearWanted();
      G.police.addHeat(step.setWanted);
    }
    if (step.type === 'escape' && G.police) G.police.clearWanted();
    stepIndex += 1;
    const steps = sys.current.steps;
    if (stepIndex < steps.length) {
      beginStep(steps[stepIndex]);
    } else {
      completeMission();
    }
  }

  function completeMission() {
    const mission = sys.current;
    const idx = sys.currentIndex;
    if (!mission) return;
    G.cash = (typeof G.cash === 'number' ? G.cash : 0) + mission.reward;
    if (!sys.missionProgress.completed.includes(idx)) {
      sys.missionProgress.completed.push(idx);
    }
    sys.missionProgress.index = idx + 1;
    if (G.audio) G.audio.missionComplete();
    if (G.hud) {
      G.hud.showMessage(`Mission complete — $${mission.reward.toLocaleString('en-US')}`);
      if (mission.complete) G.hud.subtitle(mission.complete, 5);
    }
    if (G.combat) G.combat.clearEnemies();
    setMarker(null);
    sys.current = null;
    sys.currentStep = null;
    try {
      if (G.save) G.save.save(G);
    } catch (e) { /* autosave is best-effort */ }
    if (idx + 1 < MISSIONS.length) {
      pendingIndex = idx + 1;
      nextTimer = 3;
      setObjectiveText('Next mission starting…');
    } else {
      setObjectiveText('All missions complete — free roam');
      if (G.hud) G.hud.showMessage('All missions complete — Solmar is yours');
    }
  }

  function startMission(i) {
    if (typeof i !== 'number' || i < 0) i = 0;
    autoStartDone = true;
    nextTimer = 0;
    pendingIndex = -1;
    if (i >= MISSIONS.length) {
      sys.current = null;
      sys.currentStep = null;
      sys.currentIndex = i;
      setMarker(null);
      setObjectiveText('All missions complete — free roam');
      return;
    }
    runtime = {};
    sys.currentIndex = i;
    sys.current = MISSIONS[i];
    sys.missionProgress.index = i;
    stepIndex = 0;
    if (G.hud) G.hud.showMessage(MISSIONS[i].title);
    say(MISSIONS[i].intro, 5);
    beginStep(MISSIONS[i].steps[0]);
  }

  function failMission(reason) {
    if (!sys.current) return;
    const idx = sys.currentIndex;
    if (G.hud) {
      G.hud.showMessage(`Mission failed${reason ? ` — ${reason}` : ''}`);
      G.hud.subtitle(`${NAMES.fixer}: We'll try that again. Get ready.`, 4);
    }
    if (G.combat) G.combat.clearEnemies();
    setMarker(null);
    setObjectiveText('Mission failed — retrying…');
    sys.current = null;
    sys.currentStep = null;
    pendingIndex = idx;
    nextTimer = 4;
  }

  function updateStep(dt) {
    const step = sys.currentStep;
    const p = getPlayerPos();
    if (!p) return;
    switch (step.type) {
      case 'goto':
        if (dist2(p.x, p.z, step.pos.x, step.pos.z) <= (step.radius || 8)) completeStep();
        break;
      case 'drive':
        // Must arrive behind the wheel, not on foot.
        if (G.player && !G.player.onFoot &&
          dist2(p.x, p.z, step.pos.x, step.pos.z) <= (step.radius || 8)) completeStep();
        break;
      case 'steal': {
        // If the target car never spawned, don't soft-lock the mission.
        if (!runtime.targetCar) { completeStep(); break; }
        if (G.player && G.player.vehicle === runtime.targetCar) completeStep();
        break;
      }
      case 'deliver': {
        const okCar = step.car !== 'target' ||
          (runtime.targetCar && G.player && G.player.vehicle === runtime.targetCar);
        if (okCar && dist2(p.x, p.z, step.pos.x, step.pos.z) <= (step.radius || 8)) completeStep();
        break;
      }
      case 'survive': {
        runtime.surviveT -= dt;
        const left = Math.max(0, Math.ceil(runtime.surviveT));
        if (left !== runtime.surviveShown) {
          runtime.surviveShown = left;
          setObjectiveText(`${sys.current.title} — ${step.text} (${left}s)`);
        }
        if (runtime.surviveT <= 0) completeStep();
        break;
      }
      case 'eliminate': {
        if (!G.combat) { completeStep(); break; }
        const remaining = Math.max(0, G.combat.enemies.length - (runtime.enemiesBase || 0));
        if (remaining !== runtime.remainingShown) {
          runtime.remainingShown = remaining;
          setObjectiveText(`${sys.current.title} — ${step.text} (${remaining} left)`);
        }
        if (remaining <= 0) completeStep();
        break;
      }
      case 'escape': {
        if (step.pos) {
          if (dist2(p.x, p.z, step.pos.x, step.pos.z) <= (step.radius || 10)) completeStep();
        } else if (!G.police || G.police.wanted <= 0) {
          completeStep();
        }
        break;
      }
      default:
        completeStep();
        break;
    }
  }

  function update(dt) {
    if (G.state !== 'playing') return;
    if (beacon && beacon.visible) {
      beaconT += dt;
      beacon.rotation.y += dt * 0.6;
      beacon.material.opacity = 0.22 + 0.12 * (0.5 + 0.5 * Math.sin(beaconT * 3));
      const s = 1 + 0.06 * Math.sin(beaconT * 3);
      ring.scale.set(s, s, 1);
    }
    // Delayed start of the next (or retried) mission.
    if (nextTimer > 0) {
      nextTimer -= dt;
      if (nextTimer <= 0) {
        const idx = pendingIndex;
        pendingIndex = -1;
        startMission(idx);
      }
      return;
    }
    // Auto-start when play begins: mission 0, or the saved mission if a
    // save exists. A direct startMission() call from main.js wins over this.
    if (!autoStartDone && !sys.current) {
      autoStartDone = true;
      let idx = 0;
      try {
        const saved = G.save ? G.save.load() : null;
        if (saved && typeof saved.missionIndex === 'number') idx = saved.missionIndex;
      } catch (e) { /* no usable save; start at mission 0 */ }
      if (idx >= MISSIONS.length) {
        setObjectiveText('All missions complete — free roam');
      } else {
        startMission(idx);
      }
      return;
    }
    if (!sys.current || !sys.currentStep) return;
    updateStep(dt);
  }

  const sys = {
    missions: MISSIONS,
    currentIndex: -1,
    current: null,
    currentStep: null,
    objectiveText: '',
    markerPos: null,
    missionProgress: { index: 0, completed: [] },
    update,
    startMission,
    completeStep,
    failMission,
  };
  return sys;
}
