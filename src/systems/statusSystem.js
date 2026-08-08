// ---------------------------------------------------------------------------
// STATUS SYSTEM (pure functions)
// ---------------------------------------------------------------------------
// Threshold math + the overflow -> HP-damage rule (design doc §5, §6).
// Nothing here touches the store; the store composes these.
// ---------------------------------------------------------------------------

export const THRESHOLD_RANK = { low: 0, medium: 1, high: 2 };

/**
 * Resolve which qualitative threshold a raw value falls into for a given
 * Status definition. Ranges are inclusive [min,max].
 * @returns {'low'|'medium'|'high'}
 */
export function thresholdOf(def, value) {
  const t = def.thresholds;
  if (value >= t.high[0]) return 'high';
  if (value >= t.medium[0]) return 'medium';
  return 'low';
}

/** True when `current` threshold satisfies a requirement clause. */
export function meetsThresholdClause(def, value, clause) {
  const current = THRESHOLD_RANK[thresholdOf(def, value)];
  if (clause.threshold != null) {
    return current === THRESHOLD_RANK[clause.threshold];
  }
  if (clause.minThreshold != null) {
    return current >= THRESHOLD_RANK[clause.minThreshold];
  }
  return true;
}

/**
 * Apply a delta to a status value, honoring max clamping and detrimental
 * overflow. Returns a plain result object; the caller commits it to state.
 *
 *   { nextValue, overflow, hpDamage }
 *
 * Overflow only occurs when gaining (delta > 0) on a status flagged
 * overflowDamagesHP. Each overflow point becomes 1 HP of damage
 * (PROVISIONAL 1:1 ratio, doc §6).
 */
export function computeStatusChange(def, currentValue, delta) {
  const raw = currentValue + delta;
  let nextValue = raw;
  let overflow = 0;
  let hpDamage = 0;

  if (raw > def.max) {
    nextValue = def.max;
    if (delta > 0 && def.overflowDamagesHP) {
      // Only the portion that pushed *past* an already-considered max overflows.
      overflow = raw - def.max;
      hpDamage = overflow; // 1 overflow = 1 HP (provisional)
    }
  } else if (raw < 0) {
    nextValue = 0;
  }

  return { nextValue, overflow, hpDamage };
}
