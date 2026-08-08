// ---------------------------------------------------------------------------
// Shared 3D -> screen projector.
// A <Projector/> inside each Canvas keeps the current camera here; gameplay
// code (outside the Canvas) can then ask where a world object sits on screen,
// so a status popup can appear OVER the object that generated it.
// ---------------------------------------------------------------------------

const state = { camera: null };

export function setProjectorCamera(camera) {
  state.camera = camera;
}

/**
 * Project a THREE.Vector3 world position to viewport percentages.
 * Returns { xPct, yPct } or null if there is no camera / the point is behind it.
 * (The full-screen Canvas matches the viewport, so percentages map directly to
 * the HUD overlay.)
 */
export function projectToScreen(world) {
  const cam = state.camera;
  if (!cam) return null;
  const v = world.clone().project(cam);
  if (v.z > 1) return null; // behind the camera or beyond the far plane
  return { xPct: (v.x * 0.5 + 0.5) * 100, yPct: (-v.y * 0.5 + 0.5) * 100 };
}
