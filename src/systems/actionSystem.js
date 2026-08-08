// ---------------------------------------------------------------------------
// GENERIC ACTION SYSTEM (design doc §33 "Target / Action Grammar")
// ---------------------------------------------------------------------------
// Only the abstractions the prototype actually needs: Action, Target, Destroy,
// Repeat, StatusChange. This is deliberately NOT a general rules engine.
//
// The KEY architectural point (doc §1, §12, §24, §39): an Ability's effect is a
// single rule that runs the same way in every mode. Modes differ only in the
// `ctx` (an environment adapter) they pass in, which knows how to resolve and
// destroy Targets in that environment.
//
// ctx shape (environment adapter):
//   {
//     getPrimaryTarget()   -> target | null   (aimed / selected target)
//     getValidTargets()    -> target[]        (all valid Targets right now)
//     destroyTarget(t)     -> void            (remove it from the world)
//     onEffect?(info)      -> void            (optional VFX / feedback hook)
//   }
//
// The store passes a `mods` object describing active Ability modifiers (e.g.
// Hyperfocus's armed "repeat next action" flag) and a `clearRepeat` callback.
// ---------------------------------------------------------------------------

/**
 * Resolve an ability effect against an environment ctx.
 * Returns { ok, kind, info } describing what happened (for feedback/logging).
 *
 * NOTE: `repeatNextAction` (Hyperfocus) does NOT consume a target itself — it
 * only arms a modifier. `destroyTarget` (Shatter) reads that modifier to decide
 * whether it hits one Target or repeats across all valid Targets. This is how
 * "Hyperfocus then Shatter" emerges from two independent rules — there is no
 * combined ability (doc §12, §39).
 */
export function resolveEffect(effectKey, ctx, mods, callbacks) {
  switch (effectKey) {
    case 'repeatNextAction': {
      // Hyperfocus: arm the "repeat" modifier for the player's next Action.
      callbacks.armRepeat();
      return { ok: true, kind: 'arm-repeat', info: {} };
    }

    case 'destroyTarget': {
      // Shatter: destroy a Target. If the Repeat modifier is armed, repeat this
      // Destroy against every currently-valid Target, then consume the modifier.
      const primary = ctx.getPrimaryTarget?.();
      if (!primary && !mods.repeatArmed) {
        return { ok: false, kind: 'destroy', info: { reason: 'no-target' } };
      }

      let targets;
      if (mods.repeatArmed) {
        targets = ctx.getValidTargets?.() ?? [];
        if (primary && !targets.includes(primary)) targets = [primary, ...targets];
      } else {
        targets = primary ? [primary] : [];
      }

      if (targets.length === 0) {
        return { ok: false, kind: 'destroy', info: { reason: 'no-target' } };
      }

      for (const t of targets) ctx.destroyTarget?.(t);
      ctx.onEffect?.({ kind: 'destroy', count: targets.length, repeated: mods.repeatArmed });

      if (mods.repeatArmed) callbacks.clearRepeat();

      return { ok: true, kind: 'destroy', info: { count: targets.length, repeated: mods.repeatArmed } };
    }

    default:
      // Unknown effect — fail loudly-ish but don't crash the prototype.
      // eslint-disable-next-line no-console
      console.warn('[actionSystem] unknown effect:', effectKey);
      return { ok: false, kind: 'unknown', info: {} };
  }
}
