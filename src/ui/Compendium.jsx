// ---------------------------------------------------------------------------
// COMPENDIUM (design doc §11) — persistent player knowledge.
// Discovered abilities show full details; undiscovered ones stay locked.
// ---------------------------------------------------------------------------

import React from 'react';
import { useGameStore } from '../store/useGameStore.js';
import { ABILITY_DEFS, ABILITY_ORDER } from '../data/abilities.js';
import { STATUS_DEFS } from '../data/statuses.js';

function reqText(clause) {
  const label = STATUS_DEFS[clause.status]?.label ?? clause.status;
  if (clause.threshold) return `${label}: ${clause.threshold.toUpperCase()}`;
  if (clause.minThreshold) return `${label}: ${clause.minThreshold.toUpperCase()}+`;
  return label;
}

export default function Compendium() {
  const knownAbilities = useGameStore((s) => s.knownAbilities);
  const toggleCompendium = useGameStore((s) => s.toggleCompendium);

  return (
    <div className="modal-scrim" onClick={() => toggleCompendium(false)}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <h2>COMPENDIUM</h2>
        <div className="req" style={{ marginBottom: 4 }}>
          Discovered abilities persist across runs.
        </div>

        {ABILITY_ORDER.map((id) => {
          const def = ABILITY_DEFS[id];
          const known = knownAbilities.includes(id);
          if (!known) {
            return (
              <div key={id} className="compendium-entry">
                <h3 className="locked">??? — Undiscovered</h3>
                <div className="locked">
                  Reach the right Status configuration to reveal this ability.
                </div>
              </div>
            );
          }
          return (
            <div key={id} className="compendium-entry">
              <h3>{def.name}</h3>
              <div className="req">
                <b>Requires:</b>{' '}
                {def.requirements.length
                  ? def.requirements.map(reqText).join('  ·  ')
                  : 'no Status requirement'}
              </div>
              <div className="req">
                <b>Cooldown:</b> {def.cooldown}
              </div>
              <div className="eff">
                <b>Effect:</b> {def.description}
              </div>
              <div className="flavor">{def.flavor}</div>
            </div>
          );
        })}

        <div style={{ marginTop: 14, textAlign: 'right' }}>
          <button className="btn" onClick={() => toggleCompendium(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
