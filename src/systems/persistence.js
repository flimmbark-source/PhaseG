// ---------------------------------------------------------------------------
// PERSISTENCE — Compendium knowledge across runs (design doc §10, §11)
// ---------------------------------------------------------------------------
// Only DISCOVERED ability ids persist between runs. HP / Statuses / cooldowns
// are run state and are NOT persisted here.
// ---------------------------------------------------------------------------

import { ABILITY_DEFS } from '../data/abilities.js';

const KEY = 'phaseg.knownAbilities.v1';

/** Abilities that are always known plus anything discovered in prior runs. */
export function loadKnownAbilities() {
  const baseKnown = Object.values(ABILITY_DEFS)
    .filter((a) => a.startsKnown)
    .map((a) => a.id);

  let stored = [];
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(KEY);
    if (raw) stored = JSON.parse(raw);
  } catch {
    stored = [];
  }

  return Array.from(new Set([...baseKnown, ...stored]));
}

export function saveKnownAbilities(ids) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY, JSON.stringify(ids));
    }
  } catch {
    /* ignore quota / private-mode errors in the prototype */
  }
}

/** Dev helper: wipe discovered abilities so discovery can be re-tested. */
export function clearKnownAbilities() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
