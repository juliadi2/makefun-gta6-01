// hud.js — SOLMAR HEAT heads-up display.
//
// Owns every 2D overlay element: cash, wanted stars, health bar, speed,
// objective box, context hints, subtitles, center toasts, the damage
// vignette and the canvas-2D minimap. update(G) runs every frame; the
// minimap redraws at most 10 times per second.
//
// Every DOM lookup is guarded: if an element is missing (for example on
// a test page) the HUD skips it silently instead of throwing. Systems
// are reached only through the G object passed to update(G).
//
// Minimap heading convention: the player arrow assumes the character's
// forward direction is (sin(heading), cos(heading)) in (x, z) — the
// direction of a model built facing +Z with rotation.y = heading.
// If player.js uses the opposite facing, the arrow points 180 degrees
// off and the sign in drawMinimap needs flipping (see the comment there).

import { CITY } from './config.js';

const ROAD_CENTERS = (CITY && Array.isArray(CITY.ROAD_CENTERS) && CITY.ROAD_CENTERS.length > 0)
  ? CITY.ROAD_CENTERS
  : [-240, -180, -120, -60, 0, 60, 120, 180, 240];

// City span is -247..+247 on both axes (8 blocks x 46 + 9 roads x 14 = 494).
const MAP_HALF = 247;
const MAP_SPAN = MAP_HALF * 2;
const MAP_SIZE = 200; // minimap canvas is 200x200 px
const ROAD_WIDTH_UNITS = 14;
const MINIMAP_INTERVAL_MS = 100; // 10 Hz redraw cap
const HINT_INTERVAL_MS = 200; // hint recompute throttle (it scans for cars)
const VIGNETTE_FADE_MS = 700;

// Fallback paint-shop position (Lucky's Auto Paint) if police has none.
const PAINT_SHOP_FALLBACK = { x: -180, z: 120 };

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function clamp(v, lo, hi) {
  if (typeof v !== 'number' || Number.isNaN(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function formatCash(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  return '$' + v.toLocaleString('en-US');
}

export function createHud() {
  const hasDom = typeof document !== 'undefined' && document !== null;
  const cache = new Map(); // id -> element (or null when absent)
  let mapCtx = null;
  let mapCtxTried = false;

  // Last-written values, so update() only touches the DOM on change.
  let lastCash = null;
  let lastStars = null;
  let lastHealth = -1;
  let lastSpeed = -1;
  let lastDriving = null;
  let lastHint = null;
  let lastObjective = null;
  let lastTitle = null;
  let lastWantedShown = null;
  let lastCrosshairShown = null;
  let lastHudShown = null;

  let manualObjective = null; // set by setObjective(); missions override it
  let missionBlip = null; // { x, z } or null
  let subtitleUntil = 0; // 0 = no expiry pending
  let toastUntil = 0;
  let flashAt = 0; // timestamp of the last flashDamage(), 0 = none active
  let lastMinimapDraw = 0;
  let lastHintCheck = 0;

  // Guarded element lookup. Found elements are cached; missing ones are
  // retried on the next call in case the page finished building later.
  function el(id) {
    if (!hasDom) return null;
    if (cache.has(id)) {
      const found = cache.get(id);
      if (found) return found;
    }
    let node = null;
    try {
      node = document.getElementById(id);
    } catch (e) {
      node = null;
    }
    cache.set(id, node);
    return node;
  }

  function setText(id, text) {
    const node = el(id);
    if (node && node.textContent !== text) node.textContent = text;
  }

  function setVisible(id, shown) {
    const node = el(id);
    if (!node || !node.style) return;
    const next = shown ? '' : 'none';
    if (node.style.display !== next) node.style.display = next;
  }

  function computeHint(G) {
    const player = G.player;
    if (!player) return '';
    if (!player.onFoot) return 'E — Exit car · Space — Handbrake';
    if (G.vehicles && typeof G.vehicles.nearestCar === 'function' &&
        typeof player.getPosition === 'function') {
      try {
        const pos = player.getPosition();
        if (pos && G.vehicles.nearestCar(pos, 4)) return 'E — Enter car';
      } catch (e) {
        // Fall through to the default on-foot hint.
      }
    }
    return 'WASD — Move · Shift — Run · LMB — Shoot';
  }

  function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function drawMinimap(G, now) {
    const canvas = el('minimap');
    if (!canvas) return;
    if (!mapCtx && !mapCtxTried) {
      mapCtxTried = true;
      try {
        mapCtx = canvas.getContext ? canvas.getContext('2d') : null;
      } catch (e) {
        mapCtx = null;
      }
    }
    const ctx = mapCtx;
    if (!ctx) return;

    const S = MAP_SIZE;
    const toX = (x) => ((x + MAP_HALF) / MAP_SPAN) * S;
    const toY = (z) => ((z + MAP_HALF) / MAP_SPAN) * S;

    ctx.save();
    roundedRectPath(ctx, 0, 0, S, S, 12);
    ctx.clip();

    // Background: dark city ground.
    ctx.fillStyle = '#101a24';
    ctx.fillRect(0, 0, S, S);

    // City blocks: slightly lighter slabs between the roads.
    const roadHalf = ROAD_WIDTH_UNITS / 2;
    ctx.fillStyle = '#1b2836';
    for (let i = 0; i < ROAD_CENTERS.length - 1; i++) {
      const x0 = toX(ROAD_CENTERS[i] + roadHalf);
      const x1 = toX(ROAD_CENTERS[i + 1] - roadHalf);
      for (let j = 0; j < ROAD_CENTERS.length - 1; j++) {
        const y0 = toY(ROAD_CENTERS[j] + roadHalf);
        const y1 = toY(ROAD_CENTERS[j + 1] - roadHalf);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }

    // Beach (sand) along the south edge, water beyond it.
    ctx.fillStyle = '#b89a68';
    ctx.fillRect(0, toY(190), S, toY(232) - toY(190));
    ctx.fillStyle = '#1d6a86';
    ctx.fillRect(0, toY(232), S, S - toY(232));

    // Roads: bands along every road center line, both axes.
    const roadPx = (ROAD_WIDTH_UNITS / MAP_SPAN) * S;
    ctx.strokeStyle = '#39434e';
    ctx.lineWidth = roadPx;
    ctx.beginPath();
    for (let i = 0; i < ROAD_CENTERS.length; i++) {
      const c = ROAD_CENTERS[i];
      ctx.moveTo(toX(c), 0);
      ctx.lineTo(toX(c), S);
      ctx.moveTo(0, toY(c));
      ctx.lineTo(S, toY(c));
    }
    ctx.stroke();

    // Paint shop blip: green circle with a $.
    const shop = (G.police && G.police.paintShop) || PAINT_SHOP_FALLBACK;
    if (shop && typeof shop.x === 'number' && typeof shop.z === 'number') {
      const sx = toX(shop.x);
      const sy = toY(shop.z);
      ctx.beginPath();
      ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#2fae5f';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', sx, sy + 0.5);
    }

    // Mission blip: yellow, pulsing.
    if (missionBlip) {
      const pulse = 5 + 1.6 * Math.sin(now / 180);
      ctx.beginPath();
      ctx.arc(toX(missionBlip.x), toY(missionBlip.z), pulse + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 210, 63, 0.25)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(toX(missionBlip.x), toY(missionBlip.z), pulse, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd23f';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#7a5b00';
      ctx.stroke();
    }

    // Police blips: flashing blue/red.
    const cops = (G.police && Array.isArray(G.police.copCars)) ? G.police.copCars : null;
    if (cops) {
      const bluePhase = Math.floor(now / 400) % 2 === 0;
      ctx.fillStyle = bluePhase ? '#3b82f6' : '#ef4444';
      for (let i = 0; i < cops.length; i++) {
        const car = cops[i];
        if (!car) continue;
        const p = (car.group && car.group.position) || car.position;
        if (!p || typeof p.x !== 'number' || typeof p.z !== 'number') continue;
        ctx.beginPath();
        ctx.arc(toX(p.x), toY(p.z), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Player arrow, rotated with heading.
    const player = G.player;
    if (player) {
      let px = 0;
      let pz = 0;
      let havePos = false;
      if (typeof player.getPosition === 'function') {
        try {
          const p = player.getPosition();
          if (p && typeof p.x === 'number' && typeof p.z === 'number') {
            px = p.x;
            pz = p.z;
            havePos = true;
          }
        } catch (e) {
          havePos = false;
        }
      }
      if (!havePos && player.position &&
          typeof player.position.x === 'number' && typeof player.position.z === 'number') {
        px = player.position.x;
        pz = player.position.z;
        havePos = true;
      }
      let heading = 0;
      if (player.vehicle && typeof player.vehicle.heading === 'number') {
        heading = player.vehicle.heading;
      } else if (typeof player.heading === 'number') {
        heading = player.heading;
      }
      if (havePos) {
        ctx.save();
        ctx.translate(toX(px), toY(pz));
        // Canvas angle clockwise from north for forward = (sin h, cos h).
        // If the character model faces -Z instead of +Z, use -heading here.
        ctx.rotate(Math.PI - heading);
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(5.5, 6);
        ctx.lineTo(-5.5, 6);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#0b1220';
        ctx.stroke();
        ctx.restore();
      }
    }

    // North marker.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('N', S / 2, 4);

    ctx.restore();

    // Border.
    roundedRectPath(ctx, 0.5, 0.5, S - 1, S - 1, 12);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function update(G) {
    if (!G) return;
    const now = nowMs();

    // HUD hidden on the title screen, visible in every other state.
    const hudShown = G.state !== 'title';
    if (hudShown !== lastHudShown) {
      setVisible('hud', hudShown);
      lastHudShown = hudShown;
    }

    // Cash: "$1,250" formatting.
    const cashText = formatCash(G.cash);
    if (cashText !== lastCash) {
      setText('cash', cashText);
      lastCash = cashText;
    }

    // Wanted stars: 5 glyphs, filled = current wanted, gold when > 0.
    const wanted = clamp(G.police ? G.police.wanted : 0, 0, 5);
    const starsText = '★'.repeat(wanted) + '☆'.repeat(5 - wanted);
    if (starsText !== lastStars) {
      setText('stars', starsText);
      const starsEl = el('stars');
      if (starsEl && starsEl.style) {
        starsEl.style.color = wanted > 0 ? '#ffc93c' : 'rgba(255, 255, 255, 0.35)';
      }
      lastStars = starsText;
    }
    const wantedShown = wanted > 0;
    if (wantedShown !== lastWantedShown) {
      setVisible('wanted-label', wantedShown);
      lastWantedShown = wantedShown;
    }

    // Health bar: green -> red gradient by value.
    const player = G.player || null;
    const health = clamp(player ? player.health : 100, 0, 100);
    const healthRounded = Math.round(health);
    if (healthRounded !== lastHealth) {
      const fill = el('health-fill');
      if (fill && fill.style) {
        fill.style.width = healthRounded + '%';
        fill.style.backgroundColor = 'hsl(' + Math.round(health * 1.2) + ', 75%, 45%)';
      }
      setText('health-text', String(healthRounded));
      lastHealth = healthRounded;
    }

    // Speed: km/h while driving, hidden on foot.
    const driving = !!(player && !player.onFoot);
    if (driving !== lastDriving) {
      setVisible('speed-wrap', driving);
      lastDriving = driving;
    }
    if (driving) {
      const kmh = Math.round((player.speed || 0) * 3.6);
      if (kmh !== lastSpeed) {
        setText('speed', String(kmh));
        lastSpeed = kmh;
      }
    } else if (lastSpeed !== -1) {
      lastSpeed = -1;
    }

    // Mission title (from the active mission) and objective step text.
    // The missions system is the source of truth when it exposes
    // objectiveText; otherwise the last setObjective() value is shown.
    const missions = G.missions || null;
    if (missions && missions.current && typeof missions.current.title === 'string') {
      if (missions.current.title !== lastTitle) {
        setText('mission-title', missions.current.title);
        lastTitle = missions.current.title;
      }
    }
    let objective = manualObjective;
    if (missions && typeof missions.objectiveText === 'string' && missions.objectiveText) {
      objective = missions.objectiveText;
    }
    if (objective !== null && objective !== lastObjective) {
      setText('objective', objective);
      lastObjective = objective;
    }

    // Crosshair: on foot while playing only.
    const crosshairShown = G.state === 'playing' && !!player && !!player.onFoot;
    if (crosshairShown !== lastCrosshairShown) {
      setVisible('crosshair', crosshairShown);
      lastCrosshairShown = crosshairShown;
    }

    // Context hint (throttled: it scans for a nearby car).
    if (now - lastHintCheck >= HINT_INTERVAL_MS) {
      lastHintCheck = now;
      const hint = computeHint(G);
      if (hint !== lastHint) {
        setText('hint', hint);
        lastHint = hint;
      }
    }

    // Subtitle / toast expiry.
    if (subtitleUntil && now >= subtitleUntil) {
      subtitleUntil = 0;
      setVisible('subtitle', false);
    }
    if (toastUntil && now >= toastUntil) {
      toastUntil = 0;
      setVisible('toast', false);
    }

    // Damage vignette fade.
    if (flashAt) {
      const age = now - flashAt;
      const vignette = el('damage-vignette');
      if (age >= VIGNETTE_FADE_MS) {
        if (vignette && vignette.style) vignette.style.opacity = '0';
        flashAt = 0;
      } else if (vignette && vignette.style) {
        vignette.style.opacity = String(1 - age / VIGNETTE_FADE_MS);
      }
    }

    // Minimap, capped at 10 Hz.
    if (now - lastMinimapDraw >= MINIMAP_INTERVAL_MS) {
      lastMinimapDraw = now;
      drawMinimap(G, now);
    }
  }

  // Bottom subtitle line. seconds <= 0 (or omitted) keeps it visible
  // until the next subtitle() call or a subtitle('') clear.
  function subtitle(text, seconds) {
    if (!text) {
      subtitleUntil = 0;
      const node = el('subtitle');
      if (node) node.textContent = '';
      setVisible('subtitle', false);
      return;
    }
    const node = el('subtitle');
    if (node) node.textContent = text;
    setVisible('subtitle', true);
    subtitleUntil = (typeof seconds === 'number' && seconds > 0)
      ? nowMs() + seconds * 1000
      : 0;
  }

  // Center-screen toast message. Same expiry rules as subtitle().
  function showMessage(text, seconds) {
    if (!text) {
      toastUntil = 0;
      const node = el('toast');
      if (node) node.textContent = '';
      setVisible('toast', false);
      return;
    }
    const node = el('toast');
    if (node) node.textContent = text;
    setVisible('toast', true);
    toastUntil = (typeof seconds === 'number' && seconds > 0)
      ? nowMs() + seconds * 1000
      : 0;
  }

  function setObjective(text) {
    manualObjective = (typeof text === 'string') ? text : null;
    if (manualObjective !== null && manualObjective !== lastObjective) {
      setText('objective', manualObjective);
      lastObjective = manualObjective;
    }
  }

  function setBlip(pos) {
    if (!pos || typeof pos.x !== 'number' || typeof pos.z !== 'number') {
      missionBlip = null;
      return;
    }
    missionBlip = { x: pos.x, z: pos.z };
  }

  function flashDamage() {
    flashAt = nowMs();
    const vignette = el('damage-vignette');
    if (vignette && vignette.style) vignette.style.opacity = '1';
  }

  return { update, subtitle, flashDamage, setBlip, showMessage, setObjective };
}
