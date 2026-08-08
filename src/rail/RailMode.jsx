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
import HUD from '../ui/HUD.jsx';

// ---- tuning (PROVISIONAL) ----
const SEG = 600; // frenet-frame resolution
const RAIL_SPEED = 0.16; // progress per second (fast grind)
const ROT_SPEED = 3.4; // radians / second around the rail
const PLAYER_R = 1.3; // player orbits ON the rail's surface, around its axis
const RAIL_CORE_R = 0.32; // thickness of the rail itself (a thin central beam)
const CAM_R = PLAYER_R + 3.0; // camera sits OUTSIDE the player — over-the-shoulder
const CAM_BACK = 0.045; // how far behind the player (in progress units) the camera sits
const COLLIDE_ANGLE = 0.55; // angular tolerance for an orb collision (rad)
const AIM_WINDOW_T = 0.14; // how far ahead the primary Shatter target may be
const AIM_CONE = 0.8; // angular cone for primary target selection
const REPEAT_WINDOW_T = 0.24; // Hyperfocus repeat reaches further down the rail
const EXIT_T = 0.985; // reaching here enters the second sphere

const HOTKEYS = { shatter: 'SPACE', hyperfocus: 'SHIFT' };

// Handcrafted rail curve (doc §35: no procedural generation yet).
const CURVE_POINTS = [
  [0, 0, 0],
  [0, 1.5, -16],
  [6, 3, -32],
  [3, 6.5, -50],
  [-6, 5, -68],
  [-3, 9, -88],
  [5, 7, -108],
  [1, 5, -128],
  [0, 4, -146],
];

function angDiff(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

// ---------------------------------------------------------------------------
// Orb formations (doc §22-§23). Lines usually share a Status type so the player
// can read consequences ahead of time.
// ---------------------------------------------------------------------------
// Empty stretch of rail at the very start so the player can settle into the
// controls before the first orbs arrive (nothing spawns before this progress).
const RUNWAY_T = 0.22;

function buildFormations() {
  const orbs = [];
  let id = 0;
  const line = (tStart, tEnd, count, theta, statusId, amount = 1) => {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? tStart : tStart + ((tEnd - tStart) * i) / (count - 1);
      orbs.push({ id: id++, t, theta, statusId, amount });
    }
  };

  // --- runway: 0 .. RUNWAY_T is intentionally empty ---

  // Early: a readable Focus line (top up Focus) — safe to take.
  line(RUNWAY_T + 0.0, RUNWAY_T + 0.06, 3, 0.4, 'focus');
  // A short Anxiety line — the "raise Anxiety to MEDIUM to enable Hyperfocus"
  // opportunity (doc §23). Player may take these on purpose.
  line(RUNWAY_T + 0.12, RUNWAY_T + 0.18, 3, 2.2, 'anxiety');
  // Calm reward line, offset to the other side.
  line(RUNWAY_T + 0.24, RUNWAY_T + 0.3, 3, 4.2, 'calm');
  // A scattered Anxiety wall — genuinely wants dodging when your bar is high.
  line(RUNWAY_T + 0.38, RUNWAY_T + 0.38, 1, 0.2, 'anxiety');
  line(RUNWAY_T + 0.4, RUNWAY_T + 0.4, 1, 1.6, 'anxiety');
  line(RUNWAY_T + 0.42, RUNWAY_T + 0.42, 1, 3.4, 'anxiety');
  line(RUNWAY_T + 0.44, RUNWAY_T + 0.44, 1, 5.0, 'anxiety');
  // Focus refresh before the finale.
  line(RUNWAY_T + 0.5, RUNWAY_T + 0.54, 2, 5.6, 'focus');
  // The finale STREAM: a dense band of Anxiety orbs spread across many angles.
  // Dodging all is hard; Hyperfocus + Shatter clears the whole band (doc §24).
  for (let i = 0; i < 10; i++) {
    orbs.push({
      id: id++,
      t: RUNWAY_T + 0.6 + i * 0.012,
      theta: (i / 10) * Math.PI * 2,
      statusId: 'anxiety',
      amount: 1,
    });
  }

  return orbs;
}

// ---------------------------------------------------------------------------
// Rail world (inside Canvas). All per-frame motion is imperative for smoothness;
// React state is touched only on discrete events (collisions, cooldown ticks).
// ---------------------------------------------------------------------------
function RailWorld({ heldKeys, playerStateRef, orbs, curveData, onCollide, onReachExit }) {
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

  // Precompute orb world positions once (orbs are static on the rail).
  const tmpDir = useMemo(() => new THREE.Vector3(), []);
  useMemo(() => {
    for (const orb of orbs) {
      const center = curve.getPointAt(THREE.MathUtils.clamp(orb.t, 0, 1));
      offsetDir(orb.t, orb.theta, tmpDir).multiplyScalar(PLAYER_R);
      orb.pos = center.clone().add(tmpDir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orbs]);

  const vCenter = useMemo(() => new THREE.Vector3(), []);
  const vDir = useMemo(() => new THREE.Vector3(), []);
  const vPlayer = useMemo(() => new THREE.Vector3(), []);
  const vCam = useMemo(() => new THREE.Vector3(), []);
  const vLook = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05); // clamp big frame gaps
    const ps = playerStateRef.current;

    // --- advance forward ---
    const prevT = ps.t;
    ps.t = Math.min(1, ps.t + RAIL_SPEED * dt);

    // --- rotate around the rail ---
    const k = heldKeys.current;
    if (k['a'] || k['arrowleft']) ps.theta -= ROT_SPEED * dt;
    if (k['d'] || k['arrowright']) ps.theta += ROT_SPEED * dt;

    // --- place player ---
    curve.getPointAt(ps.t, vCenter);
    offsetDir(ps.t, ps.theta, vDir).multiplyScalar(PLAYER_R);
    vPlayer.copy(vCenter).add(vDir);
    if (playerRef.current) {
      playerRef.current.position.copy(vPlayer);
    }

    // --- camera: OVER-THE-SHOULDER, outside the player at their angle ---
    // The camera orbits with the player (CAM_R > PLAYER_R), so "up" stays
    // relative to where the player currently rides around the rail. We look a
    // little further down the rail so forward motion and oncoming orbs read.
    const camT = Math.max(0, ps.t - CAM_BACK);
    curve.getPointAt(camT, vCenter);
    offsetDir(camT, ps.theta, vDir).multiplyScalar(CAM_R);
    vCam.copy(vCenter).add(vDir);
    state.camera.position.lerp(vCam, 1 - Math.pow(0.0008, dt));

    const lookT = Math.min(1, ps.t + 0.06);
    curve.getPointAt(lookT, vCenter);
    offsetDir(lookT, ps.theta, vDir).multiplyScalar(PLAYER_R);
    vLook.copy(vCenter).add(vDir);
    state.camera.lookAt(vLook);

    // --- collisions: orb crossed this frame within the angular tolerance ---
    for (const orb of orbs) {
      if (orb.consumed) continue;
      if (prevT < orb.t && orb.t <= ps.t) {
        if (angDiff(ps.theta, orb.theta) < COLLIDE_ANGLE) {
          orb.consumed = true;
          if (orb.ref?.current) orb.ref.current.visible = false;
          onCollide(orb); // apply the Status change (may overflow -> HP)
        } else {
          // Dodged — mark passed so it can be hidden as it falls behind.
          orb.passed = true;
        }
      }
      // Hide orbs that have fallen well behind the camera.
      if (orb.ref?.current && orb.t < ps.t - 0.03) orb.ref.current.visible = false;
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

    // --- reached the second sphere ---
    if (!exitedRef.current && ps.t >= EXIT_T) {
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
      <Rail curveData={curveData} />
      <StarField />

      {/* second sphere at the end of the rail */}
      <mesh position={curve.getPointAt(1).toArray()}>
        <sphereGeometry args={[3.4, 32, 32]} />
        <meshStandardMaterial color="#050208" emissive="#3a1d6e" emissiveIntensity={0.6} />
      </mesh>

      {/* player */}
      <group ref={playerRef}>
        <mesh>
          <icosahedronGeometry args={[0.5, 1]} />
          <meshStandardMaterial color="#ffffff" emissive="#66e0ff" emissiveIntensity={1.1} />
        </mesh>
        <pointLight intensity={8} distance={10} color="#88e6ff" />
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
    if (orb.consumed) continue;
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
    if (orb.consumed) return false;
    const dt = orb.t - ps.t;
    return dt > 0 && dt <= REPEAT_WINDOW_T;
  });
}

// The rail itself: a thin glowing central beam the player grinds along and
// rotates AROUND. This is a rail in open space — deliberately NOT an enclosing
// tube. The player and orbs orbit its axis at PLAYER_R.
function Rail({ curveData }) {
  const { curve } = curveData;
  const geo = useMemo(
    () => new THREE.TubeGeometry(curve, 500, RAIL_CORE_R, 10, false),
    [curve],
  );
  const glowGeo = useMemo(
    () => new THREE.TubeGeometry(curve, 500, RAIL_CORE_R * 2.2, 10, false),
    [curve],
  );
  return (
    <>
      <mesh geometry={glowGeo}>
        <meshBasicMaterial color="#7a4fff" transparent opacity={0.12} depthWrite={false} />
      </mesh>
      <mesh geometry={geo}>
        <meshStandardMaterial
          color="#d8c8ff"
          emissive="#8a5bff"
          emissiveIntensity={1.1}
          metalness={0.7}
          roughness={0.25}
        />
      </mesh>
    </>
  );
}

// Psychedelic floating specks around the rail — gives a sense of speed and the
// "tunnel-like dimension" without boxing the player inside anything.
function StarField() {
  const geo = useMemo(() => {
    const N = 900;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const r = 6 + Math.random() * 26;
      const a = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r + (Math.random() - 0.5) * 10;
      pos[i * 3 + 1] = Math.sin(a) * r + (Math.random() - 0.5) * 10;
      pos[i * 3 + 2] = 5 - Math.random() * 165;
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

function Orb({ orb }) {
  const def = STATUS_DEFS[orb.statusId];
  const ref = useRef();
  orb.ref = ref;
  useFrame((s) => {
    if (ref.current && ref.current.visible) {
      ref.current.rotation.y += 0.03;
      const p = 1 + Math.sin(s.clock.elapsedTime * 4 + orb.id) * 0.08;
      ref.current.scale.setScalar(p);
    }
  });
  return (
    <group ref={ref} position={orb.pos ? orb.pos.toArray() : [0, 0, 0]}>
      <mesh>
        <icosahedronGeometry args={[0.42, 1]} />
        <meshStandardMaterial
          color={def.color}
          emissive={def.color}
          emissiveIntensity={0.9}
          transparent
          opacity={0.92}
        />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Mode wrapper.
// ---------------------------------------------------------------------------
export default function RailMode() {
  const applyStatus = useGameStore((s) => s.applyStatus);
  const activateAbility = useGameStore((s) => s.activateAbility);
  const enterSecondSphere = useGameStore((s) => s.enterSecondSphere);

  const [fadingIn, setFadingIn] = React.useState(true);
  const [fadingOut, setFadingOut] = React.useState(false);

  // Fade in from the sphere on arrival.
  useEffect(() => {
    const t = setTimeout(() => setFadingIn(false), 60);
    return () => clearTimeout(t);
  }, []);

  // Curve + frenet frames, built once.
  const curveData = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(
      CURVE_POINTS.map((p) => new THREE.Vector3(...p)),
      false,
      'catmullrom',
      0.5,
    );
    const frames = curve.computeFrenetFrames(SEG, false);
    return { curve, frames };
  }, []);

  const orbs = useMemo(() => buildFormations(), []);
  const playerStateRef = useRef({ t: 0, theta: 0 });

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
      const ps = playerStateRef.current;
      const ctx = {
        getPrimaryTarget: () => pickPrimaryTarget(orbs, ps),
        getValidTargets: () => pickRepeatTargets(orbs, ps),
        destroyTarget: (orb) => {
          orb.consumed = true; // destroyed BEFORE it can collide — no Status applied
          if (orb.ref?.current) orb.ref.current.visible = false;
        },
        onEffect: () => {},
      };
      activateAbility(id, ctx);
    },
    [orbs, activateAbility],
  );

  const heldKeys = useKeys({
    space: () => onActivateAbility('shatter'),
    shift: () => onActivateAbility('hyperfocus'),
  });

  const onReachExit = useCallback(() => {
    setFadingOut(true);
    setTimeout(() => enterSecondSphere(), 700);
  }, [enterSecondSphere]);

  return (
    <div className="canvas-wrap">
      <Canvas camera={{ position: [0, 2, 6], fov: 65 }}>
        <RailWorld
          heldKeys={heldKeys}
          playerStateRef={playerStateRef}
          orbs={orbs}
          curveData={curveData}
          onCollide={onCollide}
          onReachExit={onReachExit}
        />
      </Canvas>

      <HUD onActivateAbility={onActivateAbility} hotkeys={HOTKEYS} />

      <div className="fade" style={{ opacity: fadingIn || fadingOut ? 1 : 0 }} />
    </div>
  );
}
