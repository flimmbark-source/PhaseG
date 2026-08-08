// ---------------------------------------------------------------------------
// HUD — persistent overlay shown in BOTH modes (design doc §29).
// Shows HP, Status bars (value + threshold + overflow warning), abilities
// (known/usable/cooldown), feedback toasts, discovery banner, compendium.
// ---------------------------------------------------------------------------

import React, { useEffect } from 'react';
import { useGameStore } from '../store/useGameStore.js';
import { STATUS_DEFS, STATUS_ORDER } from '../data/statuses.js';
import { ABILITY_DEFS, ABILITY_ORDER } from '../data/abilities.js';
import { thresholdOf } from '../systems/statusSystem.js';
import { requirementsMet } from '../systems/abilitySystem.js';
import Compendium from './Compendium.jsx';

function Vitals() {
  const hp = useGameStore((s) => s.hp);
  const hpMax = useGameStore((s) => s.hpMax);
  const statuses = useGameStore((s) => s.statuses);

  return (
    <div className="hud-vitals">
      <div className="panel">
        <div className="hp-row">
          <span className="hp-label">HP</span>
          <div className="bar">
            <div
              className="bar-fill"
              style={{ background: 'var(--hp)', transform: `scaleX(${Math.max(0, hp / hpMax)})` }}
            />
          </div>
          <span className="bar-num">
            {hp}/{hpMax}
          </span>
        </div>
      </div>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {STATUS_ORDER.map((id) => {
          const def = STATUS_DEFS[id];
          const value = statuses[id] ?? 0;
          const thr = thresholdOf(def, value);
          const full = value >= def.max;
          return (
            <div key={id} className="status-row">
              <span className="status-name" style={{ color: def.color }}>
                {def.label}
              </span>
              <div className="bar">
                <div
                  className="bar-fill"
                  style={{ background: def.color, transform: `scaleX(${value / def.max})` }}
                />
              </div>
              <span className="bar-num">
                {value}/{def.max}
              </span>
              <span className={`status-thresh ${thr}`}>{thr}</span>
              {full && def.detrimental && <span className="status-full">FULL!</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// One ability chip. `hotkey` labels the keyboard binding for the current mode.
function AbilityChip({ id, hotkey, onActivate }) {
  const known = useGameStore((s) => s.knownAbilities.includes(id));
  const statuses = useGameStore((s) => s.statuses);
  const cooldown = useGameStore((s) => s.cooldowns[id] ?? 0);
  const usable = useGameStore((s) => s.isAbilityUsable(id));
  const repeatArmed = useGameStore((s) => s.repeatArmed);

  const def = ABILITY_DEFS[id];

  if (!known) {
    // Unknown abilities are shown only as a locked silhouette (doc §10).
    return (
      <button className="ability" disabled title="Undiscovered ability">
        <div className="ability-name ability-hidden">??????</div>
        <div className="ability-sub ability-hidden">undiscovered</div>
      </button>
    );
  }

  const reqOk = requirementsMet(def, statuses);
  const armed = id === 'hyperfocus' ? repeatArmed : false;

  // Condensed status line: what's currently between you and using it.
  let sub, subCls;
  if (armed) {
    sub = 'ARMED — repeats next';
    subCls = 'ok';
  } else if (cooldown > 0) {
    sub = `cooling ${cooldown.toFixed(cooldown < 1 ? 1 : 0)}`;
    subCls = '';
  } else if (!reqOk) {
    sub = `needs ${reqSummary(def)}`;
    subCls = 'unmet';
  } else {
    sub = 'READY';
    subCls = 'ok';
  }

  const cdPct = cooldown > 0 ? (cooldown / def.cooldown) * 100 : 0;

  return (
    <button
      className={`ability ${usable ? 'usable' : ''} ${armed ? 'armed' : ''}`}
      disabled={!usable}
      onClick={() => onActivate(id)}
      title={`${def.description}${def.requirements.length ? ` — requires ${reqSummary(def)}` : ''}`}
    >
      <span className="ability-key">{hotkey}</span>
      <div className="ability-name">
        {def.name}
        <span className="ability-cdnum">CD {def.cooldown}</span>
      </div>
      <div className="ability-effect">{def.description}</div>
      <div className={`ability-sub ${subCls}`}>{sub}</div>
      {cooldown > 0 && <div className="ability-cd" style={{ width: `${cdPct}%` }} />}
    </button>
  );
}

// Compact requirement text, e.g. "Focus HIGH · Anxiety MED+".
const THRESH_ABBR = { low: 'LOW', medium: 'MED', high: 'HIGH' };
function reqSummary(def) {
  if (!def.requirements.length) return 'nothing';
  return def.requirements
    .map((c) => {
      const label = STATUS_DEFS[c.status]?.label ?? c.status;
      const th = c.threshold
        ? THRESH_ABBR[c.threshold]
        : `${THRESH_ABBR[c.minThreshold]}+`;
      return `${label} ${th}`;
    })
    .join(' · ');
}

// `onActivate` is provided by the active mode so the same chips route to the
// correct environment ctx (Grove targets vs Rail targets).
function AbilityBar({ onActivate, hotkeys }) {
  return (
    <div className="hud-abilities">
      {ABILITY_ORDER.map((id) => (
        <AbilityChip key={id} id={id} hotkey={hotkeys[id] ?? ''} onActivate={onActivate} />
      ))}
    </div>
  );
}

function Feed() {
  const feed = useGameStore((s) => s.feed);
  const expireFeed = useGameStore((s) => s.expireFeed);
  const scheduled = React.useRef(new Set());

  // Give each toast exactly ONE expiry timer from its own birth, so a burst of
  // popups doesn't keep extending the ones already fading.
  useEffect(() => {
    feed.forEach((f) => {
      if (scheduled.current.has(f.id)) return;
      scheduled.current.add(f.id);
      setTimeout(() => {
        expireFeed(f.id);
        scheduled.current.delete(f.id);
      }, 950);
    });
  }, [feed, expireFeed]);

  return (
    <div className="feed">
      {feed.map((f) => {
        let cls = f.kind;
        if (f.kind === 'status') cls += f.detrimental ? ' detri' : ' bene';
        return (
          <div
            key={f.id}
            className="feed-anchor"
            style={{ left: `${f.px ?? 50}%`, top: `${f.py ?? 30}%` }}
          >
            <div className={`feed-item ${cls}`}>{f.text}</div>
          </div>
        );
      })}
    </div>
  );
}

function DiscoveryBanner() {
  const lastDiscovery = useGameStore((s) => s.lastDiscovery);
  const clearDiscoveryBanner = useGameStore((s) => s.clearDiscoveryBanner);

  useEffect(() => {
    if (!lastDiscovery) return;
    const t = setTimeout(clearDiscoveryBanner, 2600);
    return () => clearTimeout(t);
  }, [lastDiscovery, clearDiscoveryBanner]);

  if (!lastDiscovery) return null;
  const def = ABILITY_DEFS[lastDiscovery.id];
  return (
    <div className="discovery">
      <div className="kicker">NEW ABILITY DISCOVERED</div>
      <div className="name">{def.name.toUpperCase()}</div>
    </div>
  );
}

/**
 * Top-level HUD.
 * @param {(id:string)=>void} onActivateAbility  mode-specific ability router
 * @param {Record<string,string>} hotkeys        ability id -> key label
 * @param {React.ReactNode} children             mode-specific hints/controls
 */
export default function HUD({ onActivateAbility, hotkeys = {}, children }) {
  const mode = useGameStore((s) => s.mode);
  const currentScene = useGameStore((s) => s.currentScene);
  const compendiumOpen = useGameStore((s) => s.compendiumOpen);
  const toggleCompendium = useGameStore((s) => s.toggleCompendium);

  const modeLabel = mode === 'rail' ? 'RAIL' : `SCENE · ${currentScene.toUpperCase()}`;

  return (
    <div className="hud">
      <Vitals />

      <div className="hud-topright">
        <span className="mode-tag">{modeLabel}</span>
        <button className="btn" onClick={() => toggleCompendium()}>
          Compendium
        </button>
      </div>

      <Feed />
      <DiscoveryBanner />

      {children}

      <AbilityBar onActivate={onActivateAbility} hotkeys={hotkeys} />

      {compendiumOpen && <Compendium />}
    </div>
  );
}
