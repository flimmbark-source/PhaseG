// ---------------------------------------------------------------------------
// STATUS DEFINITIONS (data-driven)
// ---------------------------------------------------------------------------
// Each Status describes its own bounds, thresholds, and overflow behavior.
// Thresholds are stored per-status so they can diverge later (design doc §5.2 /
// §33). For the prototype we reuse the same Low/Med/High ranges, but nothing in
// the systems layer assumes they are universal.
//
// PROVISIONAL: exact maxima, threshold ranges and the detrimental/overflow
// tuning below are prototype placeholders, not locked design canon.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} StatusDef
 * @property {string} id
 * @property {string} label
 * @property {string} color            display color for bars/orbs
 * @property {number} max
 * @property {boolean} detrimental     true => high values are dangerous
 * @property {boolean} overflowDamagesHP  gain past max converts to HP damage
 * @property {{low:[number,number], medium:[number,number], high:[number,number]}} thresholds
 */

/** @type {Record<string, StatusDef>} */
export const STATUS_DEFS = {
  anxiety: {
    id: 'anxiety',
    label: 'Anxiety',
    color: '#c86bff', // purple, per doc's example orb color
    max: 10,
    detrimental: true,
    overflowDamagesHP: true, // confirmed rule (doc §6)
    thresholds: { low: [0, 3], medium: [4, 7], high: [8, 10] },
  },
  focus: {
    id: 'focus',
    label: 'Focus',
    color: '#39d0ff', // cyan
    max: 10,
    detrimental: false,
    overflowDamagesHP: false,
    thresholds: { low: [0, 3], medium: [4, 7], high: [8, 10] },
  },
  calm: {
    id: 'calm',
    label: 'Calm',
    color: '#5ce6a5', // green
    max: 10,
    detrimental: false,
    overflowDamagesHP: false,
    thresholds: { low: [0, 3], medium: [4, 7], high: [8, 10] },
  },
};

// Ordered list for consistent UI rendering.
export const STATUS_ORDER = ['anxiety', 'focus', 'calm'];

// PROVISIONAL starting values. Focus begins HIGH so the Grove can drive the
// player toward the Hyperfocus configuration by raising Anxiety to MEDIUM
// (design doc §28 test sequence).
export const INITIAL_STATUS_VALUES = {
  anxiety: 0,
  focus: 8,
  calm: 0,
};

export const INITIAL_HP = 20; // PROVISIONAL (doc §4.1: exact HP unresolved)
