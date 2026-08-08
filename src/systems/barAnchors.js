// ---------------------------------------------------------------------------
// Bar-position registry. The HUD registers each bar's DOM element here so a
// popup can "chip off" the correct bar (HP loss, or a status change that has no
// world-object source). Measured lazily via getBoundingClientRect.
// ---------------------------------------------------------------------------

const els = {}; // id ('hp' | statusId) -> HTMLElement

export function registerBar(id, el) {
  if (el) els[id] = el;
}

/** Current viewport rect of a bar, or null if not registered / detached. */
export function getBarRect(id) {
  const el = els[id];
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}
