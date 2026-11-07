const TAP_SLOP_PX = 10;
const TAP_MAX_MS = 350;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP_PX = 32;
const MOMENTUM_MIN_SPEED = 0.25;
const MOMENTUM_FRICTION = 0.94;
const VELOCITY_WINDOW_MS = 90;
const INTERACTIVE = 'button, a, input, textarea, select, label, summary, [role="button"], [contenteditable=""], [contenteditable="true"], [data-touch-interactive]';
const SWALLOWED_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel'];

export function isInteractive(target) {
  return target instanceof Element && Boolean(target.closest(INTERACTIVE));
}

export function attachTouchGestures({ element, getCamera, setCamera, minScale, maxScale, onStart, onTap, onDoubleTap }) {
  const pointers = new Map();
  let pan = null;
  let pinch = null;
  let tap = null;
  let lastTap = null;
  let frame = 0;
  let pending = null;
  let momentumFrame = 0;
  let swallowClickUntil = 0;

  function schedule(camera) {
    pending = camera;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const next = pending;
      pending = null;
      if (next) setCamera(next);
    });
  }

  function flush() {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
    if (pending) setCamera(pending);
    pending = null;
  }

  function stopMomentum() {
    cancelAnimationFrame(momentumFrame);
    momentumFrame = 0;
  }

  function midpoint() {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  function localPoint(point) {
    const rect = element.getBoundingClientRect();
    return { x: point.x - rect.left, y: point.y - rect.top };
  }

  function beginPan(pointer) {
    pan = { startX: pointer.x, startY: pointer.y, camera: getCamera(), samples: [{ x: pointer.x, y: pointer.y, t: performance.now() }] };
  }

  function beginPinch() {
    const mid = midpoint();
    const camera = getCamera();
    const local = localPoint(mid);
    pinch = {
      startDistance: Math.max(mid.distance, 1),
      scale: camera.scale,
      worldX: (local.x - camera.x) / camera.scale,
      worldY: (local.y - camera.y) / camera.scale,
    };
    pan = null;
  }

  function runMomentum(velocity) {
    let { x: vx, y: vy } = velocity;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(now - last, 32);
      last = now;
      const camera = getCamera();
      setCamera({ ...camera, x: camera.x + vx * dt, y: camera.y + vy * dt });
      const decay = MOMENTUM_FRICTION ** (dt / 16);
      vx *= decay;
      vy *= decay;
      momentumFrame = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : 0;
    };
    momentumFrame = requestAnimationFrame(step);
  }

  function releaseVelocity() {
    if (!pan) return null;
    const now = performance.now();
    const recent = pan.samples.filter((sample) => now - sample.t < VELOCITY_WINDOW_MS);
    if (recent.length < 2) return null;
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dt = last.t - first.t;
    if (dt <= 0) return null;
    const velocity = { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
    return Math.hypot(velocity.x, velocity.y) >= MOMENTUM_MIN_SPEED ? velocity : null;
  }

  function onDown(event) {
    if (event.pointerType !== 'touch') return;
    stopMomentum();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      beginPan(pointers.get(event.pointerId));
      tap = { x: event.clientX, y: event.clientY, t: event.timeStamp, target: event.target, valid: true };
      onStart?.();
    } else if (pointers.size === 2) {
      if (tap) tap.valid = false;
      beginPinch();
    } else if (tap) {
      tap.valid = false;
    }
  }

  function onMove(event) {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (pinch && pointers.size >= 2) {
      const mid = midpoint();
      const local = localPoint(mid);
      const scale = Math.max(minScale(), Math.min(maxScale, pinch.scale * (mid.distance / pinch.startDistance)));
      schedule({ scale, x: local.x - pinch.worldX * scale, y: local.y - pinch.worldY * scale });
      swallowClickUntil = performance.now() + 400;
      return;
    }
    if (!pan || pointers.size !== 1) return;
    const dx = pointer.x - pan.startX;
    const dy = pointer.y - pan.startY;
    if (tap?.valid && Math.hypot(dx, dy) > TAP_SLOP_PX) tap.valid = false;
    if (tap?.valid) return;
    pan.samples.push({ x: pointer.x, y: pointer.y, t: performance.now() });
    if (pan.samples.length > 8) pan.samples.shift();
    schedule({ ...pan.camera, x: pan.camera.x + dx, y: pan.camera.y + dy });
    swallowClickUntil = performance.now() + 400;
  }

  function finishTap(event) {
    if (!tap?.valid || event.timeStamp - tap.t > TAP_MAX_MS) return;
    const detail = { clientX: tap.x, clientY: tap.y, target: tap.target };
    if (isInteractive(tap.target)) return;
    const previous = lastTap;
    if (previous && tap.t - previous.t < DOUBLE_TAP_MS && Math.hypot(tap.x - previous.x, tap.y - previous.y) < DOUBLE_TAP_SLOP_PX) {
      lastTap = null;
      onDoubleTap?.(detail);
      return;
    }
    lastTap = { x: tap.x, y: tap.y, t: tap.t };
    onTap?.(detail);
  }

  function onUp(event) {
    if (!pointers.has(event.pointerId)) return;
    flush();
    if (event.type === 'pointerup' && pointers.size === 1) finishTap(event);
    const velocity = event.type === 'pointerup' && pointers.size === 1 && tap && !tap.valid ? releaseVelocity() : null;
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      pan = null;
      pinch = null;
      tap = null;
      if (velocity) runMomentum(velocity);
    } else if (pointers.size === 1) {
      pinch = null;
      beginPan(pointers.values().next().value);
      if (tap) tap.valid = false;
    }
  }

  const handlers = {
    pointerdown: onDown,
    pointermove: onMove,
    pointerup: onUp,
    pointercancel: onUp,
  };

  SWALLOWED_EVENTS.forEach((type) => {
    element.addEventListener(type, (event) => {
      if (event.pointerType === 'touch' || type.startsWith('touch')) {
        handlers[type]?.(event);
        event.stopPropagation();
      }
    }, { capture: true, passive: false });
  });

  element.addEventListener('click', (event) => {
    if (performance.now() < swallowClickUntil) {
      event.stopPropagation();
      event.preventDefault();
    }
  }, true);

  return {
    isTouching: () => pointers.size > 0,
    cancelMomentum: stopMomentum,
  };
}
