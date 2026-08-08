// Keeps the active Canvas camera available to screenProject. Render inside a
// <Canvas>. It draws nothing.
import { useFrame, useThree } from '@react-three/fiber';
import { setProjectorCamera } from './screenProject.js';

export default function Projector() {
  const camera = useThree((s) => s.camera);
  useFrame(() => setProjectorCamera(camera));
  return null;
}
