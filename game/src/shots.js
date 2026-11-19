// Shot staging for SOLMAR HEAT screenshots.
//
// The game reads ?shot=<mode> from the URL and stages a deterministic scene
// for a screenshot: it auto-starts the game, places the player, and sets up
// the systems the shot should show. Modes:
//   start   — on foot downtown, traffic and pedestrians around, mission 0 live
//   chase   — driving a sport car with wanted level 3 and police chasing
//   mission — driving toward the mission marker, objective + minimap blip
//   combat  — on foot at the docks facing rival crew members
// Every scene is a real render of the game's own code; nothing is composited.

/** Reads the shot mode (and optional seed) from the page URL. */
export function getShotParams() {
  const q = new URLSearchParams(window.location.search);
  const shot = q.get('shot');
  const seed = Number(q.get('seed'));
  return {
    shot: shot === 'start' || shot === 'chase' || shot === 'mission' || shot === 'combat'
      ? shot
      : null,
    seed: Number.isFinite(seed) && seed > 0 ? seed : null,
  };
}

/** Puts the player on foot at a downtown intersection. */
function stageOnFootDowntown(G) {
  const p = G.player;
  p.position.set(-60, 0, -60);
  p.heading = Math.PI * 0.25;
  p.group.position.copy(p.position);
  p.group.rotation.y = p.heading;
  // Parked cars on the two roads through the intersection, ahead of the
  // player, so the street reads as lived-in.
  G.vehicles.spawnCar('sedan', -40, -55.6, Math.PI / 2, null);
  G.vehicles.spawnCar('taxi', -64.4, -35, Math.PI, null);
  G.shot = { yaw: Math.PI * 0.25 + Math.PI, pitch: 0.32, dist: 7 };
}

/** Puts the player in a sport car on a road, moving, with police after them. */
function stageChase(G) {
  const car = G.vehicles.spawnCar('sport', -120, 0, Math.PI / 2, null, 0xd7263d);
  G.player.enterVehicle(car);
  car.speed = 26;
  G.missions.startMission(2); // "Heat Wave": survive the heat
  G.police.addHeat(3);
  // Three cop cars close behind on and beside the road, so the chase reads
  // at a glance from the front camera.
  const cop1 = G.vehicles.spawnCar('police', -155, 0, Math.PI / 2, 'police');
  const cop2 = G.vehicles.spawnCar('police', -150, 9, Math.PI / 2, 'police');
  const cop3 = G.vehicles.spawnCar('police', -150, -9, Math.PI / 2, 'police');
  G.police.copCars.push(cop1, cop2, cop3);
  cop1.speed = 24;
  cop2.speed = 24;
  cop3.speed = 24;
  G.shot = { yaw: Math.PI / 2 + Math.PI, pitch: 0.28, dist: 11, front: true };
}

/** Puts the player in a car driving toward the mission marker. */
function stageMission(G) {
  const car = G.vehicles.spawnCar('sedan', 60, -120, 0, null, 0x2b6cb0);
  G.player.enterVehicle(car);
  car.speed = 18;
  G.missions.startMission(0); // "First Run"
  G.shot = { yaw: Math.PI, pitch: 0.3, dist: 10 };
}

/** Puts the player on foot at the docks facing rival crew members. */
function stageCombat(G) {
  const p = G.player;
  p.position.set(60, 0, 190);
  p.heading = Math.PI;
  p.group.position.copy(p.position);
  p.group.rotation.y = p.heading;
  G.missions.startMission(3); // "Dockside Trouble"
  G.combat.spawnEnemy(52, 168, {});
  G.combat.spawnEnemy(70, 164, {});
  G.combat.spawnEnemy(44, 176, {});
  G.combat.spawnEnemy(78, 178, {});
  G.shot = { yaw: 0, pitch: 0.3, dist: 7 };
}

/**
 * Stages the named shot mode on a running game. Call after startGame().
 * Returns true when a mode was staged.
 */
export function applyShotSetup(G, mode) {
  if (!mode) return false;
  if (mode === 'start') stageOnFootDowntown(G);
  else if (mode === 'chase') stageChase(G);
  else if (mode === 'mission') stageMission(G);
  else if (mode === 'combat') stageCombat(G);
  else return false;
  return true;
}
