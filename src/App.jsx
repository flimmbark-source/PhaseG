// ---------------------------------------------------------------------------
// App — mode switchboard (design doc §32). Each mode mounts its own Canvas so
// the very different cameras/scenes stay isolated; the shared store persists
// across the swap, which is what makes one build carry between modes.
// ---------------------------------------------------------------------------

import React from 'react';
import { useGameStore } from './store/useGameStore.js';
import GroveMode from './scenes/GroveMode.jsx';
import RailMode from './rail/RailMode.jsx';
import Scene2Mode from './scenes/Scene2Mode.jsx';

export default function App() {
  const mode = useGameStore((s) => s.mode);
  const currentScene = useGameStore((s) => s.currentScene);

  if (mode === 'rail') return <RailMode />;
  if (mode === 'scene' && currentScene === 'scene2') return <Scene2Mode />;
  return <GroveMode />;
}
