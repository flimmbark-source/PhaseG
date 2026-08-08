// ---------------------------------------------------------------------------
// HUD — persistent overlay shown in BOTH modes (design doc §29).
// Shows HP, Status bars (value + threshold + overflow warning), abilities
// (known/usable/cooldown), feedback toasts, discovery banner, compendium.
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore.js';
import { STATUS_DEFS, STATUS_ORDER } from '../data/statuses.js';
import { ABILITY_DEFS, ABILITY_ORDER } from '../data/abilities.js';
import { thresholdOf } from '../systems/statusSystem.js';
import { requirementsMet } from '../systems/abilitySystem.js';
import { registerBar, getBarRect } from '../systems/barAnchors.js';
import Compendium from './Compendium.jsx';

// Drive per-bar shudder: when the store's shudder counter for `id` ticks up,
// return true for ~600ms so the bar can shake.
function useShudder(id) {
  const count = useGameStore((s) => s.shudder[id] ?? 0);
  const prev = useRef(count);
  const [shaking, setShaking] = useState(false);
  useEffect(() => {
    if (count !== prev.current) {
      prev.current = count;
      setShaking(true);
      const t = setTimeout(() => setShaking(false), 600);
      return () => clearTimeout(t);
    }
  }, [count]);
  return shaking;
}

function Vitals() {
  const hp = useGameStore((s) => s.hp);
  const hpMax = useGameStore((s) => s.hpMax);
  const statuses = useGameStore((s) => s.statuses);
  const hpShaking = useShudder('hp');

  return (
    <div className="hud-vitals">
      <div className="panel">
        <div className="hp-row">
          <span className="hp-label">HP</span>
          <div className={`bar ${hpShaking ? 'shudder' : ''}`} ref={(el) => registerBar('hp', el)}>
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
        {STATUS_ORDER.map((id) => (
          <StatusRow key={id} id={id} value={statuses[id] ?? 0} />
        ))}
      </div>
    </div>
  );
}

function StatusRow({ id, value }) {
  const def = STATUS_DEFS[id];
  const thr = thresholdOf(def, value);
  const full = value >= def.max;
  const shaking = useShudder(id);
  return (
    <div className="status-row">
      <span className="status-name" style={{ color: def.color }}>
        {def.label}
      </span>
      <div className={`bar ${shaking ? 'shudder' : ''}`} ref={(el) => registerBar(id, el)}>
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
          <div key={f.id} className="feed-anchor" style={anchorStyle(f.anchor)}>
            <div className={`feed-item ${cls}`}>{f.text}</div>
          </div>
        );
      })}
    </div>
  );
}

// Resolve a popup's on-screen position from its anchor:
//  - screen: over the world object that generated it (projected coords)
//  - bar:    chipped off the right end of the HP/status bar
//  - none:   readable upper-center band (notes / discovery / ability)
function anchorStyle(anchor) {
  if (anchor?.type === 'screen') {
    return { left: `${anchor.xPct}%`, top: `${anchor.yPct}%` };
  }
  if (anchor?.type === 'bar') {
    const r = getBarRect(anchor.which);
    if (r) return { left: `${r.x + r.w - 4}px`, top: `${r.y + r.h / 2}px` };
  }
  return { left: '50%', top: '22%' };
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
