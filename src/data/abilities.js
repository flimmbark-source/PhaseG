// ---------------------------------------------------------------------------
// ABILITY DEFINITIONS (data-driven)
// ---------------------------------------------------------------------------
// Abilities describe RULES, not mode-specific animations (design doc §8, §24,
// §39). The SAME definition is interpreted in both Scene and Rail modes. The
// only thing that differs by mode is how Targets are resolved, which is passed
// in as a context object at activation time (see systems/actionSystem.js).
//
// Requirements are expressed against Status thresholds:
//   { status, threshold }      -> current threshold must EQUAL this
//   { status, minThreshold }   -> current threshold must be >= this
//
// PROVISIONAL: requirement thresholds, cooldown values and effect keys are
// prototype placeholders (doc §40 lists these as unresolved).
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AbilityDef
 * @property {string} id
 * @property {string} name
 * @property {string} effect        effect key resolved by the action system
 * @property {number} cooldown      abstract cooldown units (doc §13)
 * @property {Array<Object>} requirements
 * @property {boolean} startsKnown  false => hidden until first discovered
 * @property {string} description   rules text (identical across modes)
 * @property {string} flavor
 */

/** @type {Record<string, AbilityDef>} */
export const ABILITY_DEFS = {
  hyperfocus: {
    id: 'hyperfocus',
    name: 'Hyperfocus',
    effect: 'repeatNextAction',
    cooldown: 10,
    requirements: [
      { status: 'focus', threshold: 'high' }, // Focus: HIGH
      { status: 'anxiety', minThreshold: 'medium' }, // Anxiety: MEDIUM+
    ],
    startsKnown: false, // hidden until the configuration is first reached (doc §10)
    description: 'Repeat your next Action against valid Targets.',
    flavor:
      'The world narrows to a single track. Whatever you do next, you do it to everything at once.',
  },

  shatter: {
    id: 'shatter',
    name: 'Shatter',
    effect: 'destroyTarget',
    cooldown: 5,
    requirements: [], // no Status requirement in the prototype (doc §40: "if any")
    startsKnown: true, // available from the start so the interaction can be tested
    description: 'Destroy a Target.',
    flavor: 'A clean break. The Target simply stops being there.',
  },
};

export const ABILITY_ORDER = ['shatter', 'hyperfocus'];
