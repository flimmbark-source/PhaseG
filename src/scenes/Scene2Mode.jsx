// ---------------------------------------------------------------------------
// SECOND SPHERE / SCENE 2 (design doc §28 "Scene 2", Milestone 5)
// ---------------------------------------------------------------------------
// Deliberately minimal. Its only job is to PROVE persistence: the HP, Statuses,
// cooldowns and discovered abilities you arrive with are exactly the ones the
// Rail left you in. It reflects that state back to the player and lets them see
// how their Rail decisions altered their condition (doc §25, §28).
// ---------------------------------------------------------------------------

import React, { useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGameStore } from '../store/useGameStore.js';
import { STATUS_DEFS, STATUS_ORDER } from '../data/statuses.js';
import { thresholdOf } from '../systems/statusSystem.js';
import HUD from '../ui/HUD.jsx';

function DreamOrb() {
  const ref = React.useRef();
  useFrame((s) => {
    if (ref.current) ref.current.rotation.y = s.clock.elapsedTime * 0.2;
  });
  return (
    <group ref={ref}>
      <mesh>
        <icosahedronGeometry args={[2.2, 2]} />
        <meshStandardMaterial
          color="#20123f"
          emissive="#7a4fff"
          emissiveIntensity={0.7}
          wireframe
        />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[1.4, 1]} />
        <meshStandardMaterial color="#0d0722" emissive="#ff6fae" emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

export default function Scene2Mode() {
  const hp = useGameStore((s) => s.hp);
  const hpMax = useGameStore((s) => s.hpMax);
  const statuses = useGameStore((s) => s.statuses);
  const knownAbilities = useGameStore((s) => s.knownAbilities);
  const resetRun = useGameStore((s) => s.resetRun);
  const activateAbility = useGameStore((s) => s.activateAbility);
  const spawnGlyph = useGameStore((s) => s.spawnGlyph);
  const firePulse = useGameStore((s) => s.firePulse);

  // A tiny read-out of the state we arrived with.
  const summary = useMemo(
    () =>
      STATUS_ORDER.map((id) => {
        const def = STATUS_DEFS[id];
        const v = statuses[id] ?? 0;
        return `${def.label} ${v}/${def.max} (${thresholdOf(def, v).toUpperCase()})`;
      }),
    [statuses],
  );

  // Scene 2 has no Targets yet, so abilities just resolve against an empty ctx.
  const onActivateAbility = (id) => {
    const res = activateAbility(id, {});
    if (res?.ok && id === 'hyperfocus') {
      spawnGlyph('hyperfocus', 50, 42);
      firePulse();
    }
  };

  return (
    <div className="canvas-wrap">
      <Canvas camera={{ position: [0, 0.5, 6], fov: 60 }}>
        <fog attach="fog" args={['#08040f', 6, 20]} />
        <color attach="background" args={['#08040f']} />
        <ambientLight intensity={0.5} />
        <pointLight position={[3, 3, 4]} intensity={30} color="#c9a0ff" distance={25} />
        <DreamOrb />
      </Canvas>

      <HUD onActivateAbility={onActivateAbility} hotkeys={{ shatter: 'F', hyperfocus: 'G' }}>
        <div
          className="panel"
          style={{
            position: 'fixed',
            top: '22%',
            left: '50%',
            transform: 'translateX(-50%)',
            textAlign: 'center',
            maxWidth: 460,
          }}
        >
          <h2 style={{ margin: '0 0 6px', letterSpacing: 2 }}>THE SECOND SPHERE</h2>
          <p style={{ color: 'var(--text-dim)', margin: '0 0 10px' }}>
            You arrive carrying everything the Rail did to you.
          </p>
          <div style={{ fontSize: 14, lineHeight: 1.7 }}>
            <div>
              <b>HP</b> {hp}/{hpMax}
            </div>
            {summary.map((line) => (
              <div key={line}>{line}</div>
            ))}
            <div style={{ marginTop: 8, color: '#ffe071' }}>
              Known abilities: {knownAbilities.map((id) => id).join(', ')}
            </div>
          </div>
          <button className="btn primary" style={{ marginTop: 14 }} onClick={resetRun}>
            ↺ Restart Run (keeps discovered abilities)
          </button>
        </div>
        <div className="hint">
          Statuses, HP, cooldowns and discoveries all persisted across the mode change.
        </div>
      </HUD>
    </div>
  );
}
