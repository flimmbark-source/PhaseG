// ---------------------------------------------------------------------------
// THE GROVE (design doc §16-§19, Milestone 3)
// ---------------------------------------------------------------------------
// First-person, turn-like dream scene. A flower that rewards Calm but each use
// risks a Watching Eye opening (escalating Anxiety). The player decides when to
// stop and backs away to exit into the Rail.
//
// Scene-specific state (flower uses, which eyes are open) lives locally — it is
// NOT part of the persistent run state. Only Statuses / HP / cooldowns / known
// abilities live in the store, and those carry across the mode change.
// ---------------------------------------------------------------------------

import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { useGameStore } from '../store/useGameStore.js';
import { useKeys } from '../systems/useKeys.js';
import { projectToScreen } from '../systems/screenProject.js';
import Projector from '../systems/Projector.jsx';
import HUD from '../ui/HUD.jsx';

// World positions of the objects that generate status changes, so popups can
// appear over them (flower -> Calm, each eye pod -> Anxiety).
const FLOWER_WORLD = new THREE.Vector3(0, 1.25, 0);

// ---- tuning (PROVISIONAL, doc §17/§40) ----
const EYE_OPEN_CHANCE = 0.6;
const EYE_ANXIETY_ESCALATION = [1, 2, 4, 8]; // then capped at last value
const FLOWER_CALM_REWARD = 2;
const APPROACH_Z = 3.2; // closest the player can stand to the flower
const START_Z = 6.5;
const EXIT_Z = 13; // back past this => leave the scene into haze

const HOTKEYS = { shatter: 'F', hyperfocus: 'G' };

// ---------------------------------------------------------------------------
// First-person rig: WASD / arrows move along Z (approach / back away). Backing
// past EXIT_Z triggers the scene exit (doc §19: physically move backward).
// ---------------------------------------------------------------------------
function FirstPersonRig({ heldKeys, onReachExit, canMove }) {
  useFrame((state, dt) => {
    if (!canMove.current) return;
    const k = heldKeys.current;
    const speed = 6 * dt;
    let z = state.camera.position.z;

    // S is the Back Away shortcut (handled as a keypress below), so it is not a
    // hold-to-move key here; ArrowDown still nudges backward manually.
    const forward = k['w'] || k['arrowup'];
    const back = k['arrowdown'];
    if (forward) z -= speed;
    if (back) z += speed;

    z = Math.max(APPROACH_Z, z);
    state.camera.position.z = z;
    // Slight look-down so the flower sits nicely in frame.
    state.camera.position.y = 1.6;
    state.camera.lookAt(0, 1.1, 0);

    if (z >= EXIT_Z) {
      canMove.current = false;
      onReachExit();
    }
  });
  return null;
}

// ---- dreamlike flower ----
function Flower({ onUse, disabled }) {
  const ref = useRef();
  useFrame((s) => {
    if (ref.current) {
      ref.current.rotation.y += 0.005;
      ref.current.position.y = 1.05 + Math.sin(s.clock.elapsedTime * 1.3) * 0.05;
    }
  });
  const petals = useMemo(() => Array.from({ length: 7 }), []);
  return (
    <group
      ref={ref}
      position={[0, 1.05, 0]}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onUse();
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = 'default')}
    >
      {/* core */}
      <mesh>
        <icosahedronGeometry args={[0.28, 1]} />
        <meshStandardMaterial color="#ffe27a" emissive="#ffb347" emissiveIntensity={0.8} />
      </mesh>
      {/* petals */}
      {petals.map((_, i) => {
        const a = (i / petals.length) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42]} rotation={[0, -a, 0.5]}>
            <coneGeometry args={[0.18, 0.5, 5]} />
            <meshStandardMaterial color="#ff6fae" emissive="#c0206a" emissiveIntensity={0.35} />
          </mesh>
        );
      })}
      {/* stem */}
      <mesh position={[0, -0.9, 0]}>
        <cylinderGeometry args={[0.05, 0.07, 1.6, 6]} />
        <meshStandardMaterial color="#3f8f5f" />
      </mesh>
    </group>
  );
}

// ---- a watching eye on a plant ----
function EyePlant({ position, open }) {
  const iris = useRef();
  useFrame((s) => {
    if (iris.current && open) {
      // Iris tracks the camera — the unsettling "being watched" feeling.
      iris.current.lookAt(s.camera.position);
    }
  });
  return (
    <group position={position}>
      {/* stalk */}
      <mesh position={[0, -0.6, 0]}>
        <cylinderGeometry args={[0.04, 0.06, 1.2, 5]} />
        <meshStandardMaterial color="#2c5f45" />
      </mesh>
      {/* pod */}
      <mesh>
        <sphereGeometry args={[0.32, 16, 16]} />
        <meshStandardMaterial
          color={open ? '#f4f0ff' : '#20351f'}
          emissive={open ? '#8a5bff' : '#000000'}
          emissiveIntensity={open ? 0.5 : 0}
        />
      </mesh>
      {open && (
        <group ref={iris}>
          <mesh position={[0, 0, 0.3]}>
            <sphereGeometry args={[0.13, 16, 16]} />
            <meshStandardMaterial color="#1a0033" emissive="#c86bff" emissiveIntensity={0.9} />
          </mesh>
        </group>
      )}
    </group>
  );
}

function GroveWorld({ eyes, onUseFlower, heldKeys, onReachExit, canMove, flowerDisabled }) {
  return (
    <>
      <fog attach="fog" args={['#0a0716', 8, 22]} />
      <color attach="background" args={['#0a0716']} />
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 4, 2]} intensity={30} color="#ffd9a0" distance={20} />
      <hemisphereLight args={['#5a3a8a', '#0a0716', 0.5]} />

      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[16, 48]} />
        <meshStandardMaterial color="#140f24" />
      </mesh>

      <Flower onUse={onUseFlower} disabled={flowerDisabled} />
      {eyes.map((e) => (
        <EyePlant key={e.id} position={e.position} open={e.open} />
      ))}

      <Projector />
      <FirstPersonRig heldKeys={heldKeys} onReachExit={onReachExit} canMove={canMove} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Mode wrapper: owns scene logic + ability routing + HUD.
// ---------------------------------------------------------------------------
export default function GroveMode() {
  const applyStatus = useGameStore((s) => s.applyStatus);
  const tickCooldowns = useGameStore((s) => s.tickCooldowns);
  const activateAbility = useGameStore((s) => s.activateAbility);
  const exitSceneToRail = useGameStore((s) => s.exitSceneToRail);
  const pushFeed = useGameStore((s) => s.pushFeed);

  // Scene-local (non-persistent) state.
  const [eyes, setEyes] = useState(() =>
    // 5 dormant eye plants scattered behind / beside the flower.
    [
      [-2.4, 0.9, -1.5],
      [2.6, 0.9, -1.2],
      [-1.2, 0.9, -3],
      [1.4, 0.9, -3.2],
      [0, 0.9, -4.4],
    ].map((position, id) => ({ id, position, open: false })),
  );
  const eyesOpenedRef = useRef(0); // total eyes ever opened this scene (escalation index)
  const [fading, setFading] = useState(false);
  const canMove = useRef(true);

  const heldKeys = useKeys({
    e: () => handleUseFlower(),
    s: () => triggerExit(), // Back Away shortcut
    f: () => onActivateAbility('shatter'),
    g: () => onActivateAbility('hyperfocus'),
  });

  // ---- Progress Action: Use Flower (doc §15 ordering) ----
  const handleUseFlower = useCallback(() => {
    if (fading) return;
    // 1. resolve the action — Calm popup appears over the flower.
    applyStatus('calm', FLOWER_CALM_REWARD, { source: projectToScreen(FLOWER_WORLD) });

    // 2/3. advance the scene: run the Watching-Eye check
    if (Math.random() < EYE_OPEN_CHANCE) {
      setEyes((prev) => {
        const closedIdx = prev
          .map((e, i) => (!e.open ? i : -1))
          .filter((i) => i >= 0);
        if (closedIdx.length === 0) return prev; // all eyes already open
        const pick = closedIdx[Math.floor(Math.random() * closedIdx.length)];
        const next = prev.map((e, i) => (i === pick ? { ...e, open: true } : e));

        const idx = Math.min(eyesOpenedRef.current, EYE_ANXIETY_ESCALATION.length - 1);
        const gain = EYE_ANXIETY_ESCALATION[idx];
        eyesOpenedRef.current += 1;
        pushFeed('note', 'An eye opens and stares…');
        // Anxiety gain, popup appears over the eye that opened (may overflow -> HP).
        const eyeWorld = new THREE.Vector3(...prev[pick].position);
        applyStatus('anxiety', gain, { source: projectToScreen(eyeWorld) });
        return next;
      });
    }

    // 4. advance Scene-based cooldowns by one Progress Action.
    tickCooldowns(1);
  }, [applyStatus, tickCooldowns, pushFeed, fading]);

  // ---- Ability routing: Grove environment adapter (ctx) ----
  // Valid Shatter Targets in the Grove are OPEN eyes. Shatter closes an eye;
  // with Hyperfocus armed it closes every open eye — same rule as the Rail,
  // different Targets (doc §8, §12).
  const onActivateAbility = useCallback(
    (id) => {
      const openEyes = eyes.filter((e) => e.open);
      const ctx = {
        getPrimaryTarget: () => openEyes[0] ?? null,
        getValidTargets: () => openEyes,
        destroyTarget: (eye) =>
          setEyes((prev) => prev.map((e) => (e.id === eye.id ? { ...e, open: false } : e))),
        onEffect: () => {},
      };
      activateAbility(id, ctx);
    },
    [eyes, activateAbility],
  );

  // ---- Exit: back away into the haze -> Rail ----
  const triggerExit = useCallback(() => {
    if (fading) return;
    setFading(true);
    setTimeout(() => exitSceneToRail(), 750);
  }, [fading, exitSceneToRail]);

  return (
    <div className="canvas-wrap">
      <Canvas camera={{ position: [0, 1.6, START_Z], fov: 62 }}>
        <GroveWorld
          eyes={eyes}
          onUseFlower={handleUseFlower}
          heldKeys={heldKeys}
          onReachExit={triggerExit}
          canMove={canMove}
          flowerDisabled={fading}
        />
      </Canvas>

      <HUD onActivateAbility={onActivateAbility} hotkeys={HOTKEYS}>
        <div className="action-buttons">
          <button className="btn primary" onClick={handleUseFlower} disabled={fading}>
            Use Flower <span style={{ opacity: 0.6 }}>[E]</span>
          </button>
          <button className="btn" onClick={triggerExit} disabled={fading}>
            Back Away <span style={{ opacity: 0.6 }}>[S]</span> →
          </button>
        </div>
      </HUD>

      <div className="fade" style={{ opacity: fading ? 1 : 0 }} />
    </div>
  );
}
