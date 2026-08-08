// Small keyboard helper: tracks held keys + fires one-shot callbacks on keydown.
import { useEffect, useRef } from 'react';

/**
 * @param {Record<string, () => void>} onPress  key (lowercase) -> handler fired once per press
 * @returns {{ current: Record<string, boolean> }} ref of currently-held keys
 */
export function useKeys(onPress = {}) {
  const held = useRef({});
  const handlers = useRef(onPress);
  handlers.current = onPress;

  useEffect(() => {
    const norm = (e) => {
      if (e.key === ' ') return 'space';
      return e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
    };
    const down = (e) => {
      const k = norm(e);
      if (!held.current[k]) {
        const fn = handlers.current[k];
        if (fn) {
          fn();
          // Prevent page scroll on space / arrows while playing.
          if (k === 'space' || k.startsWith('arrow')) e.preventDefault();
        }
      }
      held.current[k] = true;
    };
    const up = (e) => {
      held.current[norm(e)] = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  return held;
}
