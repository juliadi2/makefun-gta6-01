// save.js — SOLMAR HEAT local save.
//
// Persists progress to localStorage under 'solmar-heat-save-v1'.
// Shape: { cash, missionIndex, completed, playerPos: [x, z], health, muted,
//          version: 1 }. Every storage access is wrapped in try/catch because
// localStorage can throw (private mode, disabled storage, quota).

const SAVE_KEY = 'solmar-heat-save-v1';

export function createSaveSystem() {
  function save(G) {
    try {
      const progress = (G.missions && G.missions.missionProgress) || { index: 0, completed: [] };
      let px = 0;
      let pz = 0;
      if (G.player) {
        const pos = typeof G.player.getPosition === 'function'
          ? G.player.getPosition()
          : G.player.position;
        if (pos && typeof pos.x === 'number' && typeof pos.z === 'number') {
          px = Math.round(pos.x * 100) / 100;
          pz = Math.round(pos.z * 100) / 100;
        }
      }
      const data = {
        version: 1,
        cash: typeof G.cash === 'number' ? G.cash : 0,
        missionIndex: typeof progress.index === 'number' ? progress.index : 0,
        completed: Array.isArray(progress.completed) ? [...progress.completed] : [],
        playerPos: [px, pz],
        health: G.player && typeof G.player.health === 'number' ? G.player.health : 100,
        muted: !!G.muted,
      };
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || data.version !== 1) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function hasSave() {
    try {
      return window.localStorage.getItem(SAVE_KEY) !== null;
    } catch (e) {
      return false;
    }
  }

  function clearSave() {
    try {
      window.localStorage.removeItem(SAVE_KEY);
    } catch (e) { /* nothing to clear, or storage unavailable */ }
  }

  return { save, load, hasSave, clearSave };
}
