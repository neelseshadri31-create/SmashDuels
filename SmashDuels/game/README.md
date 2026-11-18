# RIFT RUMBLE

A Super Smash Bros.-style platform fighter built to the Game Design Document in this project.
Runs in the browser, no build step, no dependencies.

## Play

Open the live preview, or serve the folder:

```bash
cd game
python3 -m http.server 8080
# → http://localhost:8080
```

## Animation

Each fighter has **6 distinct hand-extracted concept-art poses** (`assets/frames/{key}_0..5.png`,
bottom-aligned so feet never float). `render.js` maps game state → frame:

| state | frame(s) |
|---|---|
| idle | 0 ↔ 1 (breathing) |
| walk | 1-3-5-3 cycle |
| run | 2-4-2-5 cycle, forward lean |
| jump / fall / land | 4 / 3 / 4 + squash |
| crouch / shield | 3 / 5 |
| attack | windup pose → strike pose → settle |
| hurt / launch | 4, rotated back |
| roll | 2-3-4 with a full body spin |

Palettes are baked per frame (6 variants: default, blue, green, magenta, gold, shadow).

## Controls

**Player 1** — `A`/`D` move · `W` or `Space` jump · `S` crouch / fast-fall / drop through ·
`F` attack · `G` special · `C` shield (air dodge in the air) · `V` grab

**Player 2** — Arrows to move/jump · `Numpad 1` attack · `Numpad 2` special · `Numpad 3` jump ·
`Numpad 0` shield · `Numpad 4` grab

Gamepads are detected automatically for both players. `M` mutes audio, `Esc` pauses.

## Implemented systems

**Damage & knockback (§2)**
- Percentage damage 0–999% with no health bars
- `knockback = (base + scaling × damage%) × (100 / weight)`, per-attack angles
- Weight, gravity and fall-speed per fighter
- Blast zones on all four sides, stocks, respawn platform with invincibility

**Combat (§4)**
- Jab, three tilts, three smash attacks (chargeable), dash attack
- Five aerials per fighter including down-air spikes
- Four specials per fighter: projectile, dash, recovery, counter/trap
- Grabs, pummelling and four directional throws — grabs beat shields

**Defence (§5, §6)**
- Shrinking breakable shield with directional aiming and break stun
- Spot dodge, rolls, air dodge, tech and tech-roll
- Hitstun, directional influence, stale-move negation (last 10 moves decay to 62%)
- Ledge grabbing with climb / attack / roll / jump get-ups, edge-guarding, recovery moves

**Items (§8)** — 21 items: battering (beam sword, home-run bat, star rod), throwing (bob-omb,
shell, bumper), shooting (ray gun, fire flower), healing (heart, tomato, food), status
(star, mushrooms, metal box, bunny hood), containers (crate, capsule), summons, Smash Ball,
Hammer. Item frequency and individual toggles.

**Final Smash (§7)** — Smash Ball spawns and floats, breaks under damage, grants an
aura; press special for a screen-clearing super.

**Stages (§9)** — 6 stages with pass-through platforms, moving platforms, and hazards
(lava pools, timed pillar). Battlefield- and Final-Destination-style layouts included.

**Modes (§11)** — VS (stock / time / stamina), team battles with friendly-fire toggle,
4-player free-for-all, Classic Mode (5-stage gauntlet with boss), Break the Targets,
Home-Run Contest, Multi-Man Brawl, Training-style records screen, hazard toggles,
damage ratio, CPU levels 1–9.

**Presentation (§13, §16)** — Dynamic zoom camera that frames all fighters and punches on
KOs, hit sparks, screen shake, hitlag, slow-motion on heavy hits, combo counter,
damage-colour scale on the HUD, revival platforms, star/stealth KO effects, procedural
chiptune and SFX via WebAudio.

## Roster

| Fighter | Archetype | Signature specials |
|---|---|---|
| **Valor** the Swordsman | All-rounder | Lunar Slash · Rush Strike · Skyward Ascent · Guardian Stance |
| **Grim** the Colossus | Heavyweight | Magma Fist · Rush Strike · Skyward Ascent · Guardian Stance |
| **Astra** the Starweaver | Floaty zoner | Shooting Star Bolt · Comet Rush · Star Blink · Gravity Orb |
| **Vesper** the Shade | Rushdown | Kunai Barrage · Shadowstep Dash · Viper Ascendant · Smoke Counter |
| **Rook** the Hexshot | Projectile zoner | Hex Bullet Volley · Rune Lasso · Drone Grapple · Rune Mine |

Fighter sprites and portraits are extracted from the generated concept sheets
(`roster/*.png`), with the black background keyed to transparency.

## Files

```
game/
  index.html        shell + all screens
  css/style.css     UI styling
  js/core.js        math, input, gamepad, procedural audio, save data
  js/data.js        fighters, movesets, stages, items, rules
  js/render.js      sprite + vector renderer, stage backdrops
  js/fighter.js     physics, state machine, damage, ledge, final smash
  js/items.js       items, projectiles, mines, summons, FX
  js/ai.js          CPU opponents, levels 1–9
  js/match.js       match orchestration, camera, knockback resolution
  js/modes.js       Classic, Targets, Home-Run, Multi-Man
  js/ui.js          screens, HUD, main loop, debug hooks
```

`window.RR.step(n)` and `window.RR.makeAllCPU()` exist for automated testing.
