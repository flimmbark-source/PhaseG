# PhaseG — Scene-Based Disability Roguelike (Prototype Slice)

A first playable prototype built with **React Three Fiber**. It proves that one
persistent Status/Ability build stays meaningful across two radically different
forms of play:

1. a first-person, turn-like dream **Scene** (The Grove), and
2. a third-person, real-time **Rail** grinding section.

The whole slice is the ~5-minute loop from the design doc:

> Grove → back out into haze → Rail traversal → enter the second sphere → Scene 2,
> preserving **HP, Statuses, cooldowns and discovered Abilities** the entire way.

This is intentionally **not** a full roguelike (no map, shop, boss, inventory,
procedural generation). See the design doc for the deliberate scope limits.

## Run it

```bash
npm install
npm run dev      # open the printed localhost URL
# or
npm run build && npm run preview
```

## The core idea

You carry numeric **Statuses** (Anxiety, Focus, Calm). They cross qualitative
thresholds (Low / Medium / High), and specific *configurations* unlock
**Abilities**. Detrimental Statuses aren't just meters to minimize — Anxiety at
MEDIUM is what keeps **Hyperfocus** available, so you may *want* some of it. But
once a detrimental bar is full, further gain **overflows into HP damage**.

The intended question is: *given the condition I'm in, what can I do with it?*

## Controls

**Grove (first-person)**
- `W` / `S` — approach / back away (back far enough → leave into the Rail)
- Click the flower or `E` — **Use Flower** (a Progress Action: Calm +2, then a
  Watching Eye may open and add escalating Anxiety)
- `F` — **Shatter** (destroys an open eye) · `G` — **Hyperfocus**

**Rail (third-person, real-time)**
- On entry, choose a mode: **load a track** (mp3/wav/ogg) to grind to its beat,
  or **use the default handcrafted rail**.
- `A` / `D` — rotate around the rail's circumference
- `SPACE` — **Shatter** the aimed orb · `SHIFT` — **Hyperfocus**
- Hyperfocus **then** Shatter → Shatter repeats across the whole incoming band
- Collide with orbs on purpose to shape your build; dodge when your bar is full

**Music mode:** the track is analyzed up front (Web Audio) for beats; orbs are
placed so they **arrive on the beat**, their type follows the music's brightness
(bass → Anxiety, mid → Calm, bright → Focus), and the rail **ends when the song
ends**. Everything else (HP, Statuses, cooldowns, Shatter/Hyperfocus) is
identical to the default rail — it's just a different orb scheduler.

**Anywhere:** the **Compendium** button (top-right) lists discovered abilities.

## The two abilities (one identity, two modes)

- **Shatter** — *Destroy a Target.* Targets are open eyes in the Grove and orbs
  on the Rail. Same rule, different Targets.
- **Hyperfocus** — *Repeat your next Action against valid Targets.* Requires
  Focus HIGH + Anxiety MEDIUM+.

There is **no** "Hyperfocus Shatter" combo ability. The repeated destruction on
the Rail emerges purely from composing the two normal rules (design doc §12/§39).

## Architecture (data-driven)

```
src/
  data/
    statuses.js      # Status defs: max, thresholds, overflow behavior
    abilities.js     # Ability defs: requirements, cooldown, effect key
  systems/
    statusSystem.js  # threshold math + overflow -> HP damage (pure)
    abilitySystem.js # requirement checks, discovery detection (pure)
    actionSystem.js  # generic Action/Target/Destroy/Repeat grammar
    persistence.js   # Compendium (discovered abilities) across runs
    useKeys.js       # keyboard helper
  store/
    useGameStore.js  # single shared run state — the heart of persistence
  scenes/
    GroveMode.jsx    # Milestone 3: flower, watching eyes, escalation, exit
    Scene2Mode.jsx   # Milestone 5: minimal sphere that reflects carried state
  rail/
    RailMode.jsx     # Milestone 4: spline, 360° rotation, orbs, Shatter
  ui/
    HUD.jsx, Compendium.jsx, ui.css
  App.jsx            # mode switchboard
```

The **same `useGameStore`** backs every mode, which is why the build carries
across the Grove → Rail → Scene 2 transitions. Abilities run through one code
path (`activateAbility` → `resolveEffect`); each mode only supplies a different
*target adapter* (`ctx`) describing how to find and destroy Targets there.

## Provisional tuning

Values marked `PROVISIONAL` in code (thresholds, HP, overflow ratio, eye
probability/escalation, cooldowns, rail speed) are prototype placeholders, not
locked design canon, per the doc's Contradiction Guardrails. They live at the
top of their data/module files so they're easy to tune.
