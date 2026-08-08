// ---------------------------------------------------------------------------
// SHARED RUN STORE (design doc §33)
// ---------------------------------------------------------------------------
// The single source of truth for everything that persists across modes:
// HP, Statuses, known Abilities, cooldowns, the active Hyperfocus modifier,
// current mode and current Scene. Both the Grove and the Rail read/write here,
// which is what makes one build "carry" between the two forms of play.
// ---------------------------------------------------------------------------

import { create } from 'zustand';

import { STATUS_DEFS, INITIAL_STATUS_VALUES, INITIAL_HP } from '../data/statuses.js';
import { ABILITY_DEFS } from '../data/abilities.js';
import { computeStatusChange, thresholdOf } from '../systems/statusSystem.js';
import { isUsable, newlyDiscovered } from '../systems/abilitySystem.js';
import { resolveEffect } from '../systems/actionSystem.js';
import { loadKnownAbilities, saveKnownAbilities } from '../systems/persistence.js';

let feedSeq = 0;
let feedNextSlot = 0; // earliest time the next popup may appear (for staggering)
const FEED_STAGGER_MS = 1000; // popups queued together appear 1s apart
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Push a transient feedback item (status change, discovery, note). */
function makeFeed(kind, text, extra = {}) {
  // Position now comes from an `anchor` in `extra` (world object or bar); notes/
  // discovery/ability without an anchor fall back to a readable upper band.
  return { id: ++feedSeq, kind, text, t: nowMs(), ...extra };
}

export const useGameStore = create((set, get) => ({
  // ---- persistent run state -------------------------------------------------
  hp: INITIAL_HP,
  hpMax: INITIAL_HP,
  statuses: { ...INITIAL_STATUS_VALUES }, // id -> raw numeric value
  cooldowns: {}, // ability id -> remaining units (scene actions OR seconds)
  knownAbilities: loadKnownAbilities(), // ids known this + prior runs (Compendium)
  repeatArmed: false, // Hyperfocus's "repeat next Action" modifier

  // ---- session / flow state -------------------------------------------------
  mode: 'scene', // 'scene' | 'rail'
  currentScene: 'grove', // 'grove' | 'scene2'
  transitioning: false,

  // ---- UI feedback ----------------------------------------------------------
  feed: [], // transient toasts (status changes, discoveries)
  shudder: {}, // bar id ('hp'|statusId) -> incrementing counter (drives bar shake)
  compendiumOpen: false,
  lastDiscovery: null, // { id, at } for the big NEW ABILITY banner

  // =========================================================================
  // Derived helpers
  // =========================================================================
  getThreshold: (id) => thresholdOf(STATUS_DEFS[id], get().statuses[id] ?? 0),

  isAbilityKnown: (id) => get().knownAbilities.includes(id),

  isAbilityUsable: (id) => {
    const def = ABILITY_DEFS[id];
    if (!def) return false;
    const { statuses, cooldowns, knownAbilities } = get();
    return isUsable(def, statuses, cooldowns[id] ?? 0, knownAbilities.includes(id));
  },

  // =========================================================================
  // Feedback plumbing
  // =========================================================================
  // Schedule a BURST of popups. Separate events are staggered FEED_STAGGER_MS
  // apart so they don't pile up, but every item in one burst lands together
  // (e.g. a status change shows its over-object ghost AND its bar-chip number at
  // the same instant). Items carrying a `shudder` target shake that bar as they
  // land, kept in sync with the staggered appearance.
  _scheduleFeed: (items) => {
    if (!items.length) return;
    const now = nowMs();
    const delay = Math.max(0, feedNextSlot - now);
    feedNextSlot = Math.max(now, feedNextSlot) + FEED_STAGGER_MS;
    const commit = () =>
      set((s) => {
        let feed = s.feed;
        let shudder = s.shudder;
        for (const item of items) {
          feed = [...feed, item].slice(-8);
          if (item.shudder) shudder = { ...shudder, [item.shudder]: (shudder[item.shudder] ?? 0) + 1 };
        }
        return { feed, shudder };
      });
    if (delay <= 0) commit();
    else setTimeout(commit, delay);
  },

  pushFeed: (kind, text, extra) => get()._scheduleFeed([makeFeed(kind, text, extra)]),

  expireFeed: (id) => set((s) => ({ feed: s.feed.filter((f) => f.id !== id) })),

  // =========================================================================
  // STATUS CHANGES (doc §5, §6) — the one place statuses/HP mutate.
  // =========================================================================
  applyStatus: (id, delta, opts = {}) => {
    const def = STATUS_DEFS[id];
    if (!def) return;
    const s = get();
    const current = s.statuses[id] ?? 0;
    const { nextValue, overflow, hpDamage } = computeStatusChange(def, current, delta);

    const nextStatuses = { ...s.statuses, [id]: nextValue };
    const nextHp = Math.max(0, s.hp - hpDamage);

    set({ statuses: nextStatuses, hp: nextHp });

    // Feedback for one status event, landing together:
    //  (A) a labeled ghost OVER the world object that generated it, and
    //  (B) a bare number chipping off the relevant status bar (which shudders).
    // With no world source, only the bar chip shows.
    const items = [];
    if (!opts.silent && delta !== 0) {
      const sign = delta > 0 ? '+' : '';
      if (opts.source) {
        items.push(
          makeFeed('status', `${def.label} ${sign}${delta}`, {
            detrimental: def.detrimental,
            anchor: { type: 'screen', xPct: opts.source.xPct, yPct: opts.source.yPct },
          }),
        );
      }
      items.push(
        makeFeed('status', `${sign}${delta}`, {
          detrimental: def.detrimental,
          anchor: { type: 'bar', which: id },
          shudder: id,
        }),
      );
    }
    // HP damage from overflow chips a number off the HP bar, which shudders.
    if (hpDamage > 0) {
      items.push(
        makeFeed('overflow', `-${hpDamage}`, { anchor: { type: 'bar', which: 'hp' }, shudder: 'hp' }),
      );
    }
    get()._scheduleFeed(items);

    // Any status change can reveal a hidden ability (doc §10).
    get()._checkDiscoveries();

    return { nextValue, overflow, hpDamage };
  },

  // =========================================================================
  // DISCOVERY (doc §10, §11)
  // =========================================================================
  _checkDiscoveries: () => {
    const s = get();
    const knownSet = new Set(s.knownAbilities);
    const found = newlyDiscovered(ABILITY_DEFS, s.statuses, knownSet);
    if (found.length === 0) return;

    const nextKnown = [...s.knownAbilities, ...found];
    saveKnownAbilities(nextKnown);
    set({ knownAbilities: nextKnown, lastDiscovery: { id: found[0], at: nowMs() } });

    for (const id of found) {
      const def = ABILITY_DEFS[id];
      get().pushFeed('discovery', `NEW ABILITY DISCOVERED: ${def.name.toUpperCase()}`, { abilityId: id });
    }
  },

  clearDiscoveryBanner: () => set({ lastDiscovery: null }),

  // =========================================================================
  // COOLDOWNS (doc §13) — advanced differently per mode, but stored once.
  // =========================================================================
  // Scene mode: called with amount = 1 per Progress Action.
  // Rail mode : called every frame with amount = deltaSeconds.
  tickCooldowns: (amount) =>
    set((s) => {
      const next = { ...s.cooldowns };
      let changed = false;
      for (const id of Object.keys(next)) {
        if (next[id] > 0) {
          next[id] = Math.max(0, next[id] - amount);
          changed = true;
        }
      }
      return changed ? { cooldowns: next } : {};
    }),

  // =========================================================================
  // ABILITY ACTIVATION (doc §12, §24) — identical rule path for both modes.
  // =========================================================================
  // `ctx` is the environment adapter (see systems/actionSystem.js). Scenes and
  // the Rail supply different ctx objects but the same abilities run through it.
  activateAbility: (id, ctx = {}) => {
    const s = get();
    const def = ABILITY_DEFS[id];
    if (!def) return { ok: false, reason: 'unknown-ability' };
    if (!s.isAbilityUsable(id)) return { ok: false, reason: 'not-usable' };

    const result = resolveEffect(
      def.effect,
      ctx,
      { repeatArmed: s.repeatArmed },
      {
        armRepeat: () => set({ repeatArmed: true }),
        clearRepeat: () => set({ repeatArmed: false }),
      },
    );

    if (!result.ok) {
      // e.g. Shatter with no target available — don't spend the cooldown.
      if (result.info?.reason === 'no-target') {
        get().pushFeed('note', `${def.name}: no valid Target`);
      }
      return result;
    }

    // Spend cooldown.
    set((st) => ({ cooldowns: { ...st.cooldowns, [id]: def.cooldown } }));

    // Feedback.
    if (result.kind === 'arm-repeat') {
      get().pushFeed('ability', `${def.name} active — next Action repeats`, { abilityId: id });
    } else if (result.kind === 'destroy') {
      const n = result.info.count ?? 1;
      const via = result.info.repeated ? ` (Hyperfocus x${n})` : '';
      get().pushFeed('ability', `${def.name}: destroyed ${n} Target${n === 1 ? '' : 's'}${via}`, {
        abilityId: id,
      });
    }

    return result;
  },

  // =========================================================================
  // MODE / SCENE TRANSITIONS (doc §31) — state is preserved, never reset.
  // =========================================================================
  setMode: (mode) => set({ mode }),
  setScene: (currentScene) => set({ currentScene }),
  setTransitioning: (v) => set({ transitioning: v }),

  // Grove -> Rail. Deliberately does NOT touch statuses, HP, cooldowns or the
  // armed modifier: the whole point is that the build carries over (doc §25).
  exitSceneToRail: () => {
    get().pushFeed('note', 'The Grove recedes into haze…');
    set({ mode: 'rail' });
  },

  // Rail -> second sphere -> Scene 2. Again, no state reset.
  enterSecondSphere: () => {
    get().pushFeed('note', 'You sink into the second sphere…');
    set({ mode: 'scene', currentScene: 'scene2' });
  },

  toggleCompendium: (v) =>
    set((s) => ({ compendiumOpen: typeof v === 'boolean' ? v : !s.compendiumOpen })),

  // =========================================================================
  // RUN RESET (keeps discovered Abilities — those persist across runs)
  // =========================================================================
  resetRun: () =>
    set({
      hp: INITIAL_HP,
      hpMax: INITIAL_HP,
      statuses: { ...INITIAL_STATUS_VALUES },
      cooldowns: {},
      repeatArmed: false,
      mode: 'scene',
      currentScene: 'grove',
      transitioning: false,
      feed: [],
      shudder: {},
      lastDiscovery: null,
      // knownAbilities intentionally preserved (Compendium persistence).
    }),
}));
