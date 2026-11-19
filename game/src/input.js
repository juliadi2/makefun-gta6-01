// Input state: keyboard set, mouse deltas, edge-triggered key presses.
// Written for SOLMAR HEAT. No dependencies.

/** Creates the input state. Attach with input.attach(element) to listen. */
export function createInput() {
  const keys = new Set();
  const pressedQueue = new Set();
  const mouse = { dx: 0, dy: 0, x: 0, y: 0 };
  let mouseDown = false;
  let locked = false;

  function onKeyDown(e) {
    if (e.repeat) return;
    keys.add(e.code);
    pressedQueue.add(e.code);
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  }
  function onKeyUp(e) { keys.delete(e.code); }
  function onMouseMove(e) {
    if (document.pointerLockElement) {
      mouse.dx += e.movementX;
      mouse.dy += e.movementY;
    } else {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }
  }
  function onMouseDown(e) { if (e.button === 0) mouseDown = true; }
  function onMouseUp(e) { if (e.button === 0) mouseDown = false; }
  function onLockChange() { locked = !!document.pointerLockElement; }
  function onBlur() { keys.clear(); mouseDown = false; }

  const input = {
    keys,
    mouse,
    get mouseDown() { return mouseDown; },
    get locked() { return locked; },

    /** Start listening on the given element (usually document.body). */
    attach() {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('blur', onBlur);
      document.addEventListener('pointerlockchange', onLockChange);
    },

    /** Movement axis from WASD/arrows: x = strafe right, y = forward. */
    axis() {
      let x = 0;
      let y = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
      return { x, y };
    },

    /** True once per physical press; consumed when read. */
    pressed(code) {
      if (pressedQueue.has(code)) {
        pressedQueue.delete(code);
        return true;
      }
      return false;
    },

    /** True while the key is held down. */
    held(code) { return keys.has(code); },

    /** Mouse movement since the last call; resets the accumulator. */
    consumeMouse() {
      const out = { dx: mouse.dx, dy: mouse.dy };
      mouse.dx = 0;
      mouse.dy = 0;
      return out;
    },

    /** Request pointer lock on the canvas element. */
    lockPointer(element) {
      if (element && element.requestPointerLock) {
        try {
          const p = element.requestPointerLock();
          if (p && p.catch) p.catch(() => {});
        } catch (_e) { /* pointer lock unavailable; mouse still tracked */ }
      }
    },

    unlockPointer() {
      if (document.pointerLockElement) document.exitPointerLock();
    },

    /** Clear per-frame press state; call once per frame after systems read it. */
    endFrame() { pressedQueue.clear(); },
  };
  return input;
}
