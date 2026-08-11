// ---------------------------------------------------------------------------
// RAIL TRAVERSAL (design doc §20-§24, Milestone 4)
// ---------------------------------------------------------------------------
// Third-person, real-time. The character grinds forward along a handcrafted
// curve; the player rotates around its circumference to dodge or DELIBERATELY
// collide with Status orbs. Same HP / Statuses / abilities / cooldowns as the
// Grove — this mode just advances cooldowns in real seconds and resolves orb
// collisions as Status changes.
//
// Orbs are also generic Shatter Targets. With Hyperfocus armed, Shatter repeats
// across the incoming stream (doc §24) — emerging purely from the two rules.
// ---------------------------------------------------------------------------

import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { useGameStore } from '../store/useGameStore.js';
import { STATUS_DEFS } from '../data/statuses.js';
import { useKeys } from '../systems/useKeys.js';
import { projectToScreen } from '../systems/screenProject.js';
import Projector from '../systems/Projector.jsx';
import { analyzeTrack } from './beatAnalysis.js';
import HUD from '../ui/HUD.jsx';

// ---- tuning (PROVISIONAL) ----
const SEG = 1400; // frenet-frame resolution (higher for the longer curve)
const RAIL_SPEED = 0.05; // progress per second — ~3x the old rail length in time (~20s)
const ROT_SPEED = 6.5; // radians / second around the rail (snappy bullet-hell dodging)
// The rail is a huge, gently-curved "plain". We keep every GAMEPLAY value in its
// original angular units (rotation, collision, orb spacing all unchanged), but
// render at a large radius while dividing the angle by SCALE. Because lateral
// distance = radius * angle = (PLAYER_R*SCALE) * (theta/SCALE) = PLAYER_R*theta,
// the feel is identical — only the curvature gets gentle. Bigger SCALE = flatter.
const PLAYER_R = 0.6; // gameplay lateral unit — smaller keeps the orb field TIGHT
const SCALE = 40; // large radius => big gently-curved plain (independent of field size)
const ANG = 1 / SCALE; // gameplay angle -> actual (much smaller) world angle
const WORLD_R = PLAYER_R * SCALE; // actual world radius of the curved plain (~24)
const PLAYER_LIFT = 1.0; // lift the player up off the plain (out of the "pipe")
const CAM_GAP = 3.6; // camera height above the player, in world units
const CAM_BACK = 0.014; // how far behind the player (in progress units) the camera sits
const COLLIDE_ANGLE = 0.55; // angular tolerance for an orb collision (rad)
const AIM_WINDOW_T = 0.045; // how far ahead the primary Shatter target may be
const AIM_CONE = 0.8; // angular cone for primary target selection
const REPEAT_WINDOW_T = 0.075; // Hyperfocus repeat reaches further down the rail
const AHEAD_WINDOW_T = 0.09; // orbs are only shown/updated within this reach ahead
const ORB_HOVER = 1.0; // world units the orbs float ABOVE the plain (no clipping)
const EXIT_T = 0.99; // reaching here enters the second sphere

const HOTKEYS = { shatter: 'SPACE', hyperfocus: 'SHIFT' };

// Handcrafted rail curve (doc §35: no procedural generation yet).
// ~3x the previous length, with more dramatic climbs, dives and switchbacks.
const CURVE_POINTS = [
  [0, 0, 0],
  [0, 2, -18],
  [7, 4, -36],
  [4, 9, -56],
  [-6, 7, -76],
  [-11, 11, -98],
  [-3, 15, -120],
  [7, 13, -142],
  [13, 7, -164],
  [8, 2, -188],
  [-4, 4, -212],
  [-13, 9, -236],
  [-9, 16, -260],
  [3, 14, -284],
  [12, 9, -308],
  [7, 3, -332],
  [-5, 6, -356],
  [-13, 13, -380],
  [-6, 17, -404],
  [5, 13, -428],
  [11, 7, -452],
  [4, 3, -476],
  [-3, 5, -500],
  [0, 3, -522],
];

function angDiff(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

// Rotation-stable frames using a fixed "up" reference. Unlike Frenet frames,
// these don't flip/twist at the curve's inflection points — essential now that
// the huge radius would turn any frame twist into a big camera/ground jump. The
// plain's "up" stays consistent, like a road surface.
function buildStableFrames(curve, seg) {
  const tangents = [];
  const normals = [];
  const binormals = [];
  const up = new THREE.Vector3(0, 1, 0);
  const alt = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i <= seg; i++) {
    const tan = curve.getTangentAt(i / seg).normalize();
    const ref = Math.abs(tan.dot(up)) > 0.9 ? alt : up; // avoid near-parallel
    const bin = new THREE.Vector3().crossVectors(tan, ref).normalize();
    const nrm = new THREE.Vector3().crossVectors(bin, tan).normalize();
    tangents.push(tan);
    normals.push(nrm);
    binormals.push(bin);
  }
  return { tangents, normals, binormals };
}

// Current angular position of an orb given its motion type and the clock.
// `rel` is the orb's designed offset within its formation; `anchor` is the
// player's angle captured when the orb spawned — so the formation appears in its
// intended positions RELATIVE TO THE PLAYER wherever they are on the big plain.
// REL_CENTER re-centers the authored angle range (~0..2π) around 0, so a
// formation straddles the player instead of sitting all to one side — otherwise
// engaging each formation would nudge the player the same way and slowly march
// them to the plain's edge. It's a rigid shift, so relative positioning is kept.
const REL_CENTER = Math.PI;
function orbThetaAt(orb, time) {
  const base = orb.anchor + orb.rel - REL_CENTER;
  const m = orb.motion;
  if (!m || m.type === 'static') return base;
  if (m.type === 'orbit') return base + m.speed * time; // rotates around the rail
  if (m.type === 'wave') return base + m.amp * Math.sin(time * m.freq + orb.phase); // weaves
  return base;
}

// ---------------------------------------------------------------------------
// Orb formations (doc §22-§23). Lines usually share a Status type so the player
// can read consequences ahead of time. Different formations move differently:
// static walls, slow orbits, weaving waves, spirals, big double orbs, a rotating
// ring, and a dense finale band.
// ---------------------------------------------------------------------------
// Empty stretch of rail at the very start so the player can settle into the
// controls before the first orbs arrive (nothing spawns before this progress).
const RUNWAY_T = 0.06;

function buildFormations() {
  const orbs = [];
  let id = 0;
  const push = (t, theta, statusId, opts = {}) => {
    orbs.push({
      id: id++,
      t,
      rel: theta, // designed offset within the formation (relative to the player)
      anchor: 0, // player angle captured at spawn (set live)
      anchored: false,
      theta, // live angle (updated per frame)
      statusId,
      amount: opts.amount ?? 1,
      size: opts.size ?? 1,
      motion: opts.motion ?? { type: 'static' },
      phase: opts.phase ?? 0,
    });
  };
  // A line of `n` orbs from t0..t1, optionally fanning theta / phase per orb.
  const line = (t0, t1, n, theta, statusId, opts = {}) => {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? t0 : t0 + ((t1 - t0) * i) / (n - 1);
      push(t, theta + (opts.thetaStep ?? 0) * i, statusId, {
        ...opts,
        phase: (opts.phase ?? 0) + (opts.phaseStep ?? 0) * i,
      });
    }
  };
  const R = RUNWAY_T;

  // 1. Focus intro — static, readable, safe to take.
  line(R + 0.0, R + 0.04, 3, 0.4, 'focus');
  // 2. Short Anxiety line — the raise-to-MEDIUM-for-Hyperfocus chance (doc §23).
  line(R + 0.08, R + 0.12, 3, 2.2, 'anxiety');
  // 3. Calm cluster that slowly ORBITS the rail — track it to collect.
  line(R + 0.16, R + 0.19, 3, 4.0, 'calm', { motion: { type: 'orbit', speed: 0.7 } });
  // 4. Anxiety WEAVE — orbs wave side to side; timing matters.
  line(R + 0.23, R + 0.31, 5, 0.0, 'anxiety', {
    motion: { type: 'wave', amp: 1.4, freq: 1.6 },
    phaseStep: 0.7,
  });
  // 5. Focus refresh, two opposite sides (static).
  line(R + 0.34, R + 0.36, 1, 1.0, 'focus');
  line(R + 0.34, R + 0.36, 1, 1.0 + Math.PI, 'focus');
  // 6. Anxiety SPIRAL — angle winds around as it advances.
  line(R + 0.4, R + 0.5, 9, 0.0, 'anxiety', { thetaStep: 0.7 });
  // 7. Big double-Anxiety orbs (amount 2) — punishing to eat, tempting to Shatter.
  line(R + 0.54, R + 0.57, 2, 3.0, 'anxiety', { amount: 2, size: 1.6 });
  // 8. Rotating full RING of Anxiety — thread the gap or Shatter through it.
  line(R + 0.6, R + 0.6, 6, 0, 'anxiety', {
    thetaStep: (Math.PI * 2) / 6,
    motion: { type: 'orbit', speed: 1.2 },
  });
  // 9. Calm reward that weaves — a moving payoff.
  line(R + 0.66, R + 0.72, 4, 4.5, 'calm', {
    motion: { type: 'wave', amp: 1.1, freq: 2.0 },
    phaseStep: 0.8,
  });
  // 10. Finale: dense Anxiety band across every angle. Dodging all is hard;
  //     Hyperfocus + Shatter clears the whole stream (doc §24).
  for (let i = 0; i < 14; i++) {
    push(R + 0.78 + i * 0.008, (i / 14) * Math.PI * 2, 'anxiety');
  }

  return orbs;
}

// ---------------------------------------------------------------------------
// Rail world (inside Canvas). All per-frame motion is imperative for smoothness;
// React state is touched only on discrete events (collisions, cooldown ticks).
// ---------------------------------------------------------------------------
function RailWorld({
  heldKeys,
  playerStateRef,
  playerWorldRef,
  orbs,
  curveData,
  onCollide,
  onReachExit,
  musicMode = false,
  getMusicProgress,
}) {
  const applyStatusTick = useGameStore((s) => s.tickCooldowns);
  const playerRef = useRef();
  const aimRef = useRef();
  const prevTRef = useRef(0);
  const cdAccum = useRef(0);
  const exitedRef = useRef(false);

  const { curve, frames } = curveData;

  const frameAt = useCallback(
    (t) => {
      const i = Math.min(frames.tangents.length - 1, Math.max(0, Math.round(t * SEG)));
      return { normal: frames.normals[i], binormal: frames.binormals[i] };
    },
    [frames],
  );

  const offsetDir = useCallback(
    (t, theta, out) => {
      const { normal, binormal } = frameAt(t);
      return out
        .copy(normal)
        .multiplyScalar(Math.cos(theta))
        .addScaledVector(binormal, Math.sin(theta));
    },
    [frameAt],
  );

  // Initialize each orb's world position (recomputed every frame for movers).
  const tmpDir = useMemo(() => new THREE.Vector3(), []);
  useMemo(() => {
    for (const orb of orbs) {
      const center = curve.getPointAt(THREE.MathUtils.clamp(orb.t, 0, 1));
      offsetDir(orb.t, orb.theta * ANG, tmpDir).multiplyScalar(WORLD_R + ORB_HOVER);
      orb.pos = center.clone().add(tmpDir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orbs]);

  const vCenter = useMemo(() => new THREE.Vector3(), []);
  const vDir = useMemo(() => new THREE.Vector3(), []);
  const vPlayer = useMemo(() => new THREE.Vector3(), []);
  const vCam = useMemo(() => new THREE.Vector3(), []);
  const vLook = useMemo(() => new THREE.Vector3(), []);
  const vOrbC = useMemo(() => new THREE.Vector3(), []);
  const vOrbD = useMemo(() => new THREE.Vector3(), []);

  // Where the player ends up (t=1, angle ~0) — put the second sphere there.
  const endSpherePos = useMemo(() => {
    const c = curve.getPointAt(1);
    const d = offsetDir(1, 0, new THREE.Vector3()).multiplyScalar(WORLD_R);
    return c.add(d).toArray();
  }, [curve, offsetDir]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05); // clamp big frame gaps
    const ps = playerStateRef.current;

    // --- advance forward ---
    // Music mode ties progress to the song clock (so the rail ends exactly when
    // the track does); otherwise it advances at a fixed grind speed.
    const prevT = ps.t;
    if (musicMode && getMusicProgress) {
      ps.t = Math.min(1, Math.max(ps.t, getMusicProgress()));
    } else {
      ps.t = Math.min(1, ps.t + RAIL_SPEED * dt);
    }
    const exitT = musicMode ? 0.999 : EXIT_T;

    // --- rotate around the rail ---
    const k = heldKeys.current;
    if (k['a'] || k['arrowleft']) ps.theta -= ROT_SPEED * dt;
    if (k['d'] || k['arrowright']) ps.theta += ROT_SPEED * dt;

    // --- place player (lifted up off the plain, coplanar with the orbs) ---
    curve.getPointAt(ps.t, vCenter);
    offsetDir(ps.t, ps.theta * ANG, vDir).multiplyScalar(WORLD_R + PLAYER_LIFT);
    vPlayer.copy(vCenter).add(vDir);
    if (playerRef.current) {
      playerRef.current.position.copy(vPlayer);
    }
    if (playerWorldRef) playerWorldRef.current.copy(vPlayer); // for ability glyph placement

    // --- camera: OVER-THE-SHOULDER, outside the player at their angle ---
    // The camera orbits with the player (CAM_R > PLAYER_R), so "up" stays
    // relative to where the player currently rides around the rail. We look a
    // little further down the rail so forward motion and oncoming orbs read.
    const camT = Math.max(0, ps.t - CAM_BACK);
    curve.getPointAt(camT, vCenter);
    offsetDir(camT, ps.theta * ANG, vDir).multiplyScalar(WORLD_R + PLAYER_LIFT + CAM_GAP);
    vCam.copy(vCenter).add(vDir);
    state.camera.position.lerp(vCam, 1 - Math.pow(0.0008, dt));

    const lookT = Math.min(1, ps.t + 0.017);
    curve.getPointAt(lookT, vCenter);
    offsetDir(lookT, ps.theta * ANG, vDir).multiplyScalar(WORLD_R + PLAYER_LIFT);
    vLook.copy(vCenter).add(vDir);
    state.camera.lookAt(vLook);

    // --- move + cull orbs: only those within reach ahead are shown/updated ---
    const time = state.clock.elapsedTime;
    for (const orb of orbs) {
      const g = orb.ref?.current;
      if (!g) continue;
      const ahead = orb.t - ps.t;
      if (orb.consumed) {
        g.visible = false;
        continue;
      }
      // Spawn: the first time an orb comes into reach, anchor its formation to
      // the player's CURRENT angle, so it lands in its intended spot relative to
      // wherever the player is on the plain.
      if (!orb.anchored) {
        if (ahead <= AHEAD_WINDOW_T && ahead > -0.02) {
          orb.anchor = ps.theta;
          orb.anchored = true;
        } else {
          g.visible = false;
          continue;
        }
      }
      const vis = ahead < AHEAD_WINDOW_T && orb.t > ps.t - 0.012;
      g.visible = vis;
      if (!vis) continue;
      orb.theta = orbThetaAt(orb, time);
      curve.getPointAt(orb.t, vOrbC);
      // radius WORLD_R + ORB_HOVER => the orb floats just above the plain.
      offsetDir(orb.t, orb.theta * ANG, vOrbD).multiplyScalar(WORLD_R + ORB_HOVER);
      orb.pos.copy(vOrbC).add(vOrbD);
      g.position.copy(orb.pos);
      g.rotation.y += 0.04;
      g.scale.setScalar(orb.size * (1 + Math.sin(time * 4 + orb.id) * 0.08));
    }

    // --- collisions: orb crossed this frame within the angular tolerance ---
    for (const orb of orbs) {
      if (orb.consumed || !orb.anchored) continue;
      if (prevT < orb.t && orb.t <= ps.t) {
        if (angDiff(ps.theta, orb.theta) < COLLIDE_ANGLE) {
          orb.consumed = true;
          if (orb.ref?.current) orb.ref.current.visible = false;
          onCollide(orb); // apply the Status change (may overflow -> HP)
        } else {
          orb.passed = true; // dodged
        }
      }
    }
    prevTRef.current = ps.t;

    // --- aim indicator: snap ring to the current primary Shatter target ---
    const aim = pickPrimaryTarget(orbs, ps);
    if (aimRef.current) {
      if (aim) {
        aimRef.current.visible = true;
        aimRef.current.position.copy(aim.pos);
      } else {
        aimRef.current.visible = false;
      }
    }

    // --- cooldowns advance in REAL seconds (throttled to limit re-renders) ---
    cdAccum.current += dt;
    if (cdAccum.current >= 0.1) {
      applyStatusTick(cdAccum.current);
      cdAccum.current = 0;
    }

    // --- reached the second sphere (song end in music mode) ---
    if (!exitedRef.current && ps.t >= exitT) {
      exitedRef.current = true;
      onReachExit();
    }
  });

  return (
    <>
      <fog attach="fog" args={['#0b0420', 14, 70]} />
      <color attach="background" args={['#0b0420']} />
      <ambientLight intensity={0.6} />
      <pointLight position={[0, 6, -20]} intensity={60} distance={80} color="#b98bff" />

      <Projector />
      <GroundRibbon curveData={curveData} />
      <StarField />

      {/* second sphere at the end of the plain, where the player actually ends up */}
      <mesh position={endSpherePos}>
        <sphereGeometry args={[5, 32, 32]} />
        <meshStandardMaterial color="#050208" emissive="#3a1d6e" emissiveIntensity={0.6} />
      </mesh>

      {/* player */}
      <group ref={playerRef}>
        <mesh>
          <icosahedronGeometry args={[0.7, 1]} />
          <meshStandardMaterial color="#ffffff" emissive="#66e0ff" emissiveIntensity={1.1} />
        </mesh>
        <pointLight intensity={20} distance={22} color="#88e6ff" />
      </group>

      {/* orbs */}
      {orbs.map((orb) => (
        <Orb key={orb.id} orb={orb} />
      ))}

      {/* aim reticle */}
      <group ref={aimRef} visible={false}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.75, 0.06, 8, 24]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1.4} />
        </mesh>
      </group>
    </>
  );
}

// Primary Shatter target: nearest un-consumed orb ahead of the player, within
// the aim window AND angular cone. Pure fn so the keypress handler can reuse it.
function pickPrimaryTarget(orbs, ps) {
  let best = null;
  let bestDt = Infinity;
  for (const orb of orbs) {
    if (orb.consumed || !orb.anchored) continue;
    const dt = orb.t - ps.t;
    if (dt <= 0 || dt > AIM_WINDOW_T) continue;
    if (angDiff(ps.theta, orb.theta) > AIM_CONE) continue;
    if (dt < bestDt) {
      bestDt = dt;
      best = orb;
    }
  }
  return best;
}

// All valid Targets for a Hyperfocus-boosted Shatter: the whole incoming band.
function pickRepeatTargets(orbs, ps) {
  return orbs.filter((orb) => {
    if (orb.consumed || !orb.anchored) return false;
    const dt = orb.t - ps.t;
    return dt > 0 && dt <= REPEAT_WINDOW_T;
  });
}

// The rail rendered as a huge, gently-curved ground ribbon: a wide surface that
// follows the spline at WORLD_R, so the player feels like they're crossing a
// large curved plain rather than circling a thin pole. A faint wireframe grid
// on top reveals the curvature.
function GroundRibbon({ curveData }) {
  const { curve, frames } = curveData;
  const geom = useMemo(() => {
    const NL = 420; // segments along the rail
    const NW = 20; // segments across the plain
    const halfW = 0.75; // half-width of the plain, in ACTUAL (world) radians
    const centerA = 0; // centered on the player's working area
    const positions = [];
    const uvs = [];
    const tmp = new THREE.Vector3();
    for (let i = 0; i <= NL; i++) {
      const t = i / NL;
      const c = curve.getPointAt(t);
      const fi = Math.min(frames.normals.length - 1, Math.round(t * SEG));
      const nrm = frames.normals[fi];
      const bin = frames.binormals[fi];
      for (let j = 0; j <= NW; j++) {
        const a = centerA - halfW + 2 * halfW * (j / NW);
        tmp
          .copy(nrm)
          .multiplyScalar(Math.cos(a))
          .addScaledVector(bin, Math.sin(a))
          .multiplyScalar(WORLD_R);
        positions.push(c.x + tmp.x, c.y + tmp.y, c.z + tmp.z);
        uvs.push(t * 60, j / NW);
      }
    }
    const indices = [];
    const stride = NW + 1;
    for (let i = 0; i < NL; i++) {
      for (let j = 0; j < NW; j++) {
        const a = i * stride + j;
        indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }, [curve, frames]);

  return (
    <group>
      <mesh geometry={geom}>
        <meshStandardMaterial
          color="#221146"
          emissive="#3a1d6e"
          emissiveIntensity={0.28}
          metalness={0.2}
          roughness={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={geom}>
        <meshBasicMaterial color="#7a4fff" wireframe transparent opacity={0.14} />
      </mesh>
    </group>
  );
}

// Psychedelic floating specks around the rail — gives a sense of speed and the
// "tunnel-like dimension" without boxing the player inside anything.
function StarField() {
  const geo = useMemo(() => {
    const N = 2200;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const r = 6 + Math.random() * 30;
      const a = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r + (Math.random() - 0.5) * 14;
      pos[i * 3 + 1] = Math.sin(a) * r + (Math.random() - 0.5) * 14;
      pos[i * 3 + 2] = 10 - Math.random() * 545; // span the full (longer) rail
      c.setHSL((Math.random() * 0.35 + 0.58) % 1, 0.75, 0.62);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  return (
    <points geometry={geo}>
      <pointsMaterial size={0.35} vertexColors transparent opacity={0.85} sizeAttenuation />
    </points>
  );
}

// Dumb orb mesh — position / rotation / scale / visibility are all driven by
// the RailWorld frame loop (so hundreds of beat orbs stay cheap: one loop, not
// one useFrame per orb).
function Orb({ orb }) {
  const def = STATUS_DEFS[orb.statusId];
  const moving = orb.motion && orb.motion.type !== 'static';
  const ref = useRef();
  orb.ref = ref;
  return (
    <group ref={ref} position={orb.pos ? orb.pos.toArray() : [0, 0, 0]}>
      <mesh>
        <icosahedronGeometry args={[0.42, moving ? 0 : 1]} />
        <meshStandardMaterial
          color={def.color}
          emissive={def.color}
          emissiveIntensity={moving ? 1.15 : 0.9}
          transparent
          opacity={0.94}
          flatShading={moving}
        />
      </mesh>
      {orb.amount > 1 && (
        <mesh>
          <icosahedronGeometry args={[0.58, 0]} />
          <meshBasicMaterial color={def.color} wireframe transparent opacity={0.5} />
        </mesh>
      )}
    </group>
  );
}

// Convert analyzed beats into orbs. Each orb sits at the rail-progress the
// player will occupy at that beat's time, so it ARRIVES on the beat.
function buildBeatOrbs(beats, duration) {
  return beats.map((b, id) => ({
    id,
    t: Math.min(0.999, b.time / duration),
    rel: b.theta,
    anchor: 0,
    anchored: false,
    theta: b.theta,
    statusId: b.statusId,
    amount: 1,
    size: b.size ?? 1,
    motion: { type: 'static' },
    phase: 0,
  }));
}

// ---------------------------------------------------------------------------
// Mode wrapper.
// ---------------------------------------------------------------------------
export default function RailMode() {
  const applyStatus = useGameStore((s) => s.applyStatus);
  const activateAbility = useGameStore((s) => s.activateAbility);
  const enterSecondSphere = useGameStore((s) => s.enterSecondSphere);
  const spawnGlyph = useGameStore((s) => s.spawnGlyph);
  const firePulse = useGameStore((s) => s.firePulse);

  // Flow: choose a track (or the default rail), analyze, then play.
  const [phase, setPhase] = React.useState('select'); // select | analyzing | ready | playing
  const [trackInfo, setTrackInfo] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [musicMode, setMusicMode] = React.useState(false);
  const [orbs, setOrbs] = React.useState(null);
  const [fadingIn, setFadingIn] = React.useState(false);
  const [fadingOut, setFadingOut] = React.useState(false);

  // Web Audio playback state (music mode).
  const audioCtxRef = useRef(null);
  const bufferRef = useRef(null);
  const beatsRef = useRef(null);
  const durationRef = useRef(0);
  const startTimeRef = useRef(0);
  const sourceRef = useRef(null);
  const exitingRef = useRef(false);

  // Curve + frenet frames, built once.
  const curveData = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(
      CURVE_POINTS.map((p) => new THREE.Vector3(...p)),
      false,
      'catmullrom',
      0.5,
    );
    const frames = buildStableFrames(curve, SEG);
    return { curve, frames };
  }, []);

  const playerStateRef = useRef({ t: 0, theta: 0 });
  const playerWorldRef = useRef(new THREE.Vector3());

  // Stop audio + close context when leaving the Rail.
  useEffect(
    () => () => {
      try {
        sourceRef.current?.stop();
      } catch {
        /* already stopped */
      }
      try {
        audioCtxRef.current?.close();
      } catch {
        /* already closed */
      }
    },
    [],
  );

  const getMusicProgress = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !durationRef.current) return 0;
    return (ctx.currentTime - startTimeRef.current) / durationRef.current;
  }, []);

  const onCollide = useCallback(
    (orb) => {
      // Popup appears over the orb that was hit; a number also chips off the bar.
      applyStatus(orb.statusId, orb.amount, { source: orb.pos ? projectToScreen(orb.pos) : null });
    },
    [applyStatus],
  );

  // Ability routing: Rail environment adapter. Orbs are the generic Targets.
  const onActivateAbility = useCallback(
    (id) => {
      if (!orbs) return;
      const ps = playerStateRef.current;
      const hitPositions = []; // world positions of Targets destroyed this activation
      const ctx = {
        getPrimaryTarget: () => pickPrimaryTarget(orbs, ps),
        getValidTargets: () => pickRepeatTargets(orbs, ps),
        destroyTarget: (orb) => {
          orb.consumed = true; // destroyed BEFORE it can collide — no Status applied
          if (orb.ref?.current) orb.ref.current.visible = false;
          if (orb.pos) hitPositions.push(orb.pos.clone());
        },
        onEffect: () => {},
      };
      const res = activateAbility(id, ctx);
      if (!res?.ok) return;

      // Ability FX: glyph over everything the ability affected.
      if (id === 'shatter') {
        for (const pos of hitPositions) {
          const s = projectToScreen(pos);
          if (s) spawnGlyph('shatter', s.xPct, s.yPct - 5);
        }
      } else if (id === 'hyperfocus') {
        const s = projectToScreen(playerWorldRef.current);
        if (s) spawnGlyph('hyperfocus', s.xPct, s.yPct - 9);
        firePulse();
      }
    },
    [orbs, activateAbility, spawnGlyph, firePulse],
  );

  const heldKeys = useKeys({
    space: () => onActivateAbility('shatter'),
    shift: () => onActivateAbility('hyperfocus'),
  });

  const onReachExit = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    try {
      sourceRef.current?.stop();
    } catch {
      /* already stopped */
    }
    setFadingOut(true);
    setTimeout(() => enterSecondSphere(), 700);
  }, [enterSecondSphere]);

  // ---- track selection / analysis / playback ----
  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPhase('analyzing');
    try {
      const { ctx, buffer, duration, beats } = await analyzeTrack(file);
      audioCtxRef.current = ctx;
      bufferRef.current = buffer;
      durationRef.current = duration;
      beatsRef.current = beats;
      setTrackInfo({ name: file.name, duration, beatCount: beats.length });
      setPhase('ready');
    } catch {
      setError('Could not read that audio file. Try another mp3/wav/ogg.');
      setPhase('select');
    }
  };

  const startMusic = async () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      await ctx.resume();
    } catch {
      /* ignore */
    }
    const src = ctx.createBufferSource();
    src.buffer = bufferRef.current;
    src.connect(ctx.destination);
    src.onended = () => onReachExit();
    src.start();
    startTimeRef.current = ctx.currentTime;
    sourceRef.current = src;

    playerStateRef.current = { t: 0, theta: 0 };
    exitingRef.current = false;
    setOrbs(buildBeatOrbs(beatsRef.current, durationRef.current));
    setMusicMode(true);
    setFadingIn(true);
    setPhase('playing');
    setTimeout(() => setFadingIn(false), 60);
  };

  const useDefaultRail = () => {
    playerStateRef.current = { t: 0, theta: 0 };
    exitingRef.current = false;
    setOrbs(buildFormations());
    setMusicMode(false);
    setFadingIn(true);
    setPhase('playing');
    setTimeout(() => setFadingIn(false), 60);
  };

  if (phase !== 'playing') {
    return (
      <TrackSelect
        phase={phase}
        trackInfo={trackInfo}
        error={error}
        onPickFile={onPickFile}
        onStart={startMusic}
        onDefault={useDefaultRail}
        onBack={() => setPhase('select')}
      />
    );
  }

  return (
    <div className="canvas-wrap">
      <Canvas camera={{ position: [0, 2, 6], fov: 65 }}>
        <RailWorld
          heldKeys={heldKeys}
          playerStateRef={playerStateRef}
          playerWorldRef={playerWorldRef}
          orbs={orbs}
          curveData={curveData}
          onCollide={onCollide}
          onReachExit={onReachExit}
          musicMode={musicMode}
          getMusicProgress={getMusicProgress}
        />
      </Canvas>

      <HUD onActivateAbility={onActivateAbility} hotkeys={HOTKEYS} />

      <div className="fade" style={{ opacity: fadingIn || fadingOut ? 1 : 0 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pre-rail track picker. Load an mp3 to grind to its beat, or take the default
// handcrafted rail.
// ---------------------------------------------------------------------------
function TrackSelect({ phase, trackInfo, error, onPickFile, onStart, onDefault, onBack }) {
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <div className="track-select">
      <div className="panel track-panel">
        <h2>ENTER THE RAIL</h2>
        <p className="track-sub">
          Load a track and the rail becomes its beat — orbs arrive on the beat and the run ends
          when the song does. Or take the handcrafted rail.
        </p>

        {phase === 'analyzing' && <div className="track-status">Analyzing beats…</div>}

        {phase === 'ready' && trackInfo && (
          <div className="track-status">
            <b>{trackInfo.name}</b>
            <div className="track-meta">
              {fmt(trackInfo.duration)} · {trackInfo.beatCount} beats detected
            </div>
            <div className="track-actions">
              <button className="btn primary" onClick={onStart}>
                Start ▶
              </button>
              <button className="btn" onClick={onBack}>
                Choose different
              </button>
            </div>
          </div>
        )}

        {(phase === 'select' || phase === 'analyzing') && (
          <>
            <label className={`btn track-file ${phase === 'analyzing' ? 'disabled' : ''}`}>
              ♪ Load a track (mp3 / wav / ogg)
              <input
                type="file"
                accept="audio/*"
                onChange={onPickFile}
                disabled={phase === 'analyzing'}
                style={{ display: 'none' }}
              />
            </label>
            {error && <div className="track-error">{error}</div>}
            <button className="btn" onClick={onDefault} disabled={phase === 'analyzing'}>
              Use the default rail →
            </button>
          </>
        )}
      </div>
    </div>
  );
}
