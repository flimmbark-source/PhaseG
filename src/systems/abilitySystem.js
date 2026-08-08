// ---------------------------------------------------------------------------
// ABILITY SYSTEM (pure functions)
// ---------------------------------------------------------------------------
// Requirement checking, discovery detection and usability (design doc §9-§13).
// ---------------------------------------------------------------------------

import { STATUS_DEFS } from '../data/statuses.js';
import { meetsThresholdClause } from './statusSystem.js';

/** True when every requirement clause is satisfied by the current statuses. */
export function requirementsMet(def, statuses) {
  return def.requirements.every((clause) => {
    const sdef = STATUS_DEFS[clause.status];
    const value = statuses[clause.status] ?? 0;
    return meetsThresholdClause(sdef, value, clause);
  });
}

/**
 * An ability is USABLE only when it is known, its Status requirements are
 * currently satisfied, and its cooldown is ready (doc §2, §13).
 */
export function isUsable(def, statuses, cooldownRemaining, known) {
  if (!known) return false;
  if ((cooldownRemaining ?? 0) > 0) return false;
  return requirementsMet(def, statuses);
}

/**
 * Given the full ability table + current statuses + known set, return the ids
 * of any hidden abilities whose requirements are now satisfied for the FIRST
 * time. Used to drive discovery notifications (doc §10).
 */
export function newlyDiscovered(abilityDefs, statuses, knownSet) {
  const discovered = [];
  for (const def of Object.values(abilityDefs)) {
    if (def.startsKnown) continue;
    if (knownSet.has(def.id)) continue;
    if (requirementsMet(def, statuses)) discovered.push(def.id);
  }
  return discovered;
}
