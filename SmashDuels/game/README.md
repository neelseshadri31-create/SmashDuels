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

Every fighter draws on **~95 hand-authored frames** sliced from its concept sheet into a
packed atlas: `assets/atlas/{key}.png` + `assets/atlas/{key}.json` (built by
`tools/slice_roster.py`, which reads `roster/*_spritesheet.png`).

| group | animations |
|---|---|
| locomotion | idle · walk · run · jump · fall · land · dash |
| ground | jab · utilt · stilt (forward tilt) · dtilt · usmash · ssmash · dsmash |
| aerial | nair · fair · bair · uair · dair |
| specials | nspecial · sspecial · uspecial · dspecial |
| defence / misc | shield · shieldbreak · spotdodge · rollfwd · rollback · airdodge · grabbed · grab · throw · down · getup · respawn · taunt 1-3 |
| reactions | hurt · launch · ko · crouch (derived: the source rows are re-composed with a lean, squash and a hit flash) |

Each frame carries an anchor — the fitted cell's centre-x and the row's feet line — so a
fighter stays planted while its animation plays instead of skating or jittering. VFX that
was drawn separately from the pose (crescents, dust, projectiles) rides in the frame's
`fx` list and is blitted additively.

`render.js` maps game state → animation (`STATE_ANIM`), and an attack's `startup / active /
dur` → a fraction of its row (`MOVE_ANIM`, `SPECIAL_ANIM`), so windup → strike → settle
lines up with the hitbox instead of a fixed frame counter. Palettes are a per-variant tint
of the whole atlas (6 variants: default, blue, green, magenta, gold, shadow). If a sheet is
missing, `drawFighter` falls back to the procedural vector fighter.

**Fluidity is a draw-rate problem, not a frame-count one.** The simulation is a fixed 60 Hz
step, so on a 120/144 Hz panel half the frames would show the same tick twice — 13 stuck
frames across a run row, measured. `Sprites.beginFrame(match, alpha)` therefore leads each drawn
frame a fraction of a tick into the next one (fighters, items, projectiles, summons *and* the
camera, so nothing slides relative to anything else), clamped to the travel the step actually
made: an impulse above 1.25 px/tick, a hitlag freeze or a wall that scrubs the velocity cancels
the lead for that frame rather than drawing a move the sim then takes back. At 60 Hz `alpha` is
0 and the whole path is a no-op, byte for byte.

Two rules keep the picture and the collision honest, because the sheets do not always
draw a whole swing: **an attack's phases drive both** (`vfxGate` fades a baked crescent
in across the wind-up and holds it at full strength exactly while the hitbox is live;
`attackSwing` adds a coil → throw lean/squash so a 1-tile row still reads as anticipation
then impact), and **the art gets a vote on the hitbox but only along the axis the blow
travels** — a drawn limb may extend a box up to ~0.85 of a body-height, never sideways
for a horizontal swing, and the *hurt* box measures the figure alone, not its effects.
Rows the slicer could not split are re-cut by `tools/atlas_desmerge.py` from the shipped
atlas PNG (no re-slicing), which is what turned the last merged filmstrips into animation.

Where a row is *short* rather than merged — the sheets only drew two dash frames, two roll
frames, and no dash-attack row at all — re-cutting cannot help, so the frames are drawn:
`tools/slice_rows.py` takes a generated sheet of poses on a flat magenta field, splits it by
ink mass (rows, then cells), scales a whole row to that fighter's reference height, keys its
baked effect into a separate overlay tile so `vfxGate` can still fade it — but leaves the
frame as one tile when the biggest blob in it is too flat to be a pose, because a smoke puff
that happens to be wider than the ninja beside it is not the body — packs the tiles into
space the atlas is not already using (growing the canvas if there is none) and rewrites the
row in the JSON.  Idempotent per row.

`--revert` is not: it restores the atlas to the state saved **before the first injection ever
ran**, so it takes the other injected rows with it.  Undo *one* batch by restoring that key's
`json` + `png` from git (`git show HEAD:./game/assets/atlas/grim.json > …`, both files) and
re-running the tool; `atlascheck`'s `rows:` test is what tells you if you forgot.

Pillow is the only dependency, and a sandbox that has just been rebuilt will not have it in the
system Python (PEP 668): `python3 -m venv /tmp/venv && /tmp/venv/bin/pip install pillow`.

```bash
/tmp/venv/bin/python tools/slice_rows.py --key grim \
        --sheet assets-src/rows/grim-rows.png --rows dashattack,dash,rollfwd,rollback --cells 4
/tmp/venv/bin/python tools/slice_rows.py --key grim --sheet assets-src/rows/grim-loco.png \
        --rows idle,walk,run --cells 8,8,8 --dry --preview /tmp/prev.png   # look first
```

Rows are matched from the **top** of the sheet, so `--rows walk,run` against a three-row sheet
labels row 1 `walk` and row 2 `run` and only warns that a row went unused.  Either list every
row in order, or crop the sheet down to the rows you want (the `--dry` preview shows which
band became which row before a byte is written).

### Watching an animation without a browser

`tools/film.js` drives the engine at a fixed tick and writes down every `drawImage` the
renderer asked for — plus the live hitbox and hurtbox of that same tick — and
`tools/film_render.py` pastes the real atlas tiles through those transforms into a contact
sheet and an animated GIF per fighter (needs Pillow; nothing else):

```bash
node tools/film.js valor                     # record one fighter's rows at 60 Hz
node tools/film.js grim rushB                # …the reported case: run, then B, into a foe
node tools/film.js valor --hz=120 --blend=0  # …as a 120 Hz panel sees it, blending off
python3 tools/film_render.py valor            # → anim-films/valor.film.png / .gif
python3 tools/film_render.py --rows fsmash,walk,dash   # just those rows
python3 tools/film_render.py valor --cols 13  # tile count per row (13 = one per tick)
```

Both the contact sheet and the GIF draw the tile the renderer asked for, so the dissolve
(`render.js`'s `mix`, which fades a loop row into its next cell) is visible in them — and if a
frame ever looks wrong there but right in the browser, believe the browser and check that
`tools/film_render.py` is clipping to each tile's source rect: sampling an atlas without
clipping bleeds the neighbouring art through, and a 4px dust speck becomes a 170px flame.

Two switches are worth knowing when a film disagrees with your eyes: `Sprites.setSmooth(false)`
turns off the dissolve between cells (hard cuts, the retro read), and `--blend=0` turns off the
sub-tick position lead — which on a 120 Hz panel takes grim's walk/run from 0 stuck frames back
to 30 each, so a row that films smooth and feels smooth is the same measurement twice.

`--hz` records the frames *between* ticks as well as the tick itself, and the contact sheet
then counts **stuck frames**: consecutive drawn frames that blit the same tile at the same x/y.
That is the whole of "running feels laggy" as a number, and it is how a blend or a lead gets
reviewed without a browser — a stuck cell is outlined in red, a blended one is tagged `α0.5`.
`--blend=0` turns the sub-tick lead off for the comparison.

It is the shipped `Sprites.drawSpriteFighter`, so what the film shows is what the game
paints; it is not a browser, so treat it as ground truth for timing, anchors, stride sync
and box-vs-art, not for shader-level fidelity.

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
- Grabs, pummelling and four directional throws — grabs beat shields; a hold that is never
  thrown releases on its own after `GRAB_HOLD_MAX` = 120 ticks, so nobody is pinned by a grab
- One move lands at most its authored hits (`1 + multi`) on the same target per action

**Defence (§5, §6)**
- Shrinking breakable shield with directional aiming and break stun
- Spot dodge, rolls, air dodge, tech and tech-roll
- Hitstun, directional influence, stale-move negation (last 10 moves decay to 62%)
- Ledge grabbing with climb / attack / roll / jump get-ups, edge-guarding, recovery moves

**Items (§8)** — 22 items: battering (beam sword, home-run bat, star rod), throwing (bob-omb,
shell, bumper), shooting (ray gun, fire flower), healing (heart, tomato, food), status
(star, mushrooms, metal box, bunny hood), containers (crate, capsule), summons, Smash Ball,
Hammer. Item frequency and individual toggles. A swing or shot of a held item costs
`ITEM_SWING` = 24 ticks, for the CPU's own item path as well as the player's button.

Each one draws a generated sprite from `assets/items/` (built by `tools/slice_items.py` out of
`assets-src/items/*.png`), placed by what an item *is* rather than by its collision box: a
resting item sits on its bottom edge, so a crate stands on the deck instead of sinking through
it, and a held item hangs off the holder's own hurtbox at the knuckle line, mirrors with the
facing and swings through an attack. `items.json` carries the drawn size and the mirror flag;
if the art is missing the old vector icon still draws, so nothing can blank.

**Final Smash (§7)** — Smash Ball spawns and floats, breaks under damage, grants an
aura; press special for a screen-clearing super.

**Stages (§9)** — 16 decks with pass-through platforms, moving platforms (a fighter — and an
item — standing on a mover rides its `p.dx/p.dy` for the tick), and hazards (lava pools, timed
pillar) that re-arm on a 45-tick `HAZARD_REHIT` rather than billing you every frame of contact.
Ten of them are the Super Smash Bros. Ultimate *templates* copied as geometry: the Battlefield
form (flat deck, two soft platforms to the sides, one high in the middle, one low over the
centre), its Big and Small sizes, the Final Destination / Ω form (the same deck with the soft
platforms deleted), and the tournament layouts — Pokémon Stadium 2, Town & City, Smashville,
Yoshi's Story, Lylat Cruise, Kalos Pokémon League.  `tools/simtest.js`'s `decks:` test checks
each one against the form its `sub` claims, so a layout cannot drift away from the name it is
sold under.  What is deliberately *not* copied: damage hazards on the flat decks, Town & City's
rising road segments, Smashville's rotating deck, the League's platforms that fall away — the
platform model has no `oneWayDrop`, and inventing one under a "give me maps" request is how a
deck acquires a new way to fall out of the world.

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

Fighter art is sliced out of the generated concept sheets (`roster/*.png`) by
`tools/slice_roster.py`; the sheet's dithered background is keyed to transparency per
component, and tiles are deduplicated so a reused pose costs one atlas rect.

(needs numpy + scipy + Pillow; run from the project root, i.e. `SmashDuels/`)

```bash
python3 tools/slice_roster.py --report   # audit what the slicer recovered
python3 tools/slice_roster.py            # rewrite game/assets/atlas/*
```

### Which build the browser is running

`js/core.js` defines `BUILD`, and `index.html` links every script and the stylesheet with a
`?v=` of that token; the atlas and item fetches in `js/render.js` carry it too, because a PNG
from one build and a JSON from another draws tiles out of the wrong rectangle.  This is not
decoration: the preview is a plain static server that sends no `Cache-Control`, so a browser
tab is free to keep executing a script it fetched an hour ago without asking again — which is
how a fixed move stays "still broken" while every test about it is green.  So bump `BUILD`
and the queries in the same commit as any change under `game/js` or `game/assets`, and when a
report says an old bug is still there, read the `[rift] build …` line the game prints on boot
(or `UI.diag().build`) before believing it.  `tools/atlascheck.js` fails the build if the
token in `core.js` and the ones in `index.html`/`render.js` drift apart.

## Tests

The engine runs headless in node — no browser, no canvas (also from the project root):

```bash
node tools/animtest.js      # animation states, frame data, hitbox geometry  (29)
node tools/simtest.js       # physics, collision, state machine, 4-player   (35)
node tools/atlascheck.js    # atlases + the sprite renderer                   (15)
node tools/cloudtest.js     # cloud save sync: merge, conflicts, offline      (15)
```

All four boot the shipped files (`js/core.js … js/match.js`, plus `js/render.js` for the atlas
suite and `js/cloud.js` for the sync suite) inside a stubbed DOM, so the code under test is the
code that runs in the browser. `cloudtest.js` also stubs `fetch` with a server that speaks the
same protocol as the Postgres function in `supabase/migrations/`, so both sides of the wire are
covered without a project. Pass a substring to filter, `V=1` for stacks.

`animtest`'s `flow:` test is the one that watches the half a structural check cannot see: it
drives a real dash, roll and each injected attack at 60 Hz and counts how many of a row's
cells the renderer actually *spends* while the move is live.  A four-cell row that a move only
shows two frames of is two frames of art and two frames of nothing, and the atlas stays
perfectly well-formed either way.

## Cloud saves (optional)

Progress lives in `localStorage` (`js/core.js` → `SAVE`). `js/cloud.js` can additionally mirror
it to one Supabase row per player so a second device picks up where the first left off —
unlocks, Rift Coins, stats, records, challenges. It is off until you paste a project URL and
publishable key in **RECORDS → CLOUD SAVES**, it never blocks play, and every failure path
(offline, wrong key, project paused, 500) degrades to the local save. See
[`../supabase/README.md`](../supabase/README.md) for the schema and the one dashboard toggle it
needs.

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
  js/cloud.js       optional cross-device save sync (see above)
  assets/atlas/     {key}.png + {key}.json — packed animation atlases (generated)
  assets/items/     {key}.png + items.json — item sprites (generated, see tools/slice_items.py)

tools/
  slice_roster.py       roster sheets → atlas + animation meta
  slice_rows.py         generated pose sheets → extra rows injected into an atlas
  slice_items.py        generated item sheet → game/assets/items + items.json
  atlas_desmerge.py     re-cut the merged attack rows the slicer could not split
  harness.js            headless boot (stub DOM/canvas/audio) shared by the suites
  animtest.js           animation + hitbox tests  · node tools/animtest.js
  film.js               record what the renderer draws, tick by tick
  film_render.py        …and turn it into a contact sheet + GIF
  simtest.js            simulation tests        · node tools/simtest.js
  atlascheck.js         atlas + renderer tests  · node tools/atlascheck.js
  cloudtest.js          save-sync tests         · node tools/cloudtest.js

supabase/
  README.md         project setup, what is stored, the sync contract
  migrations/       player_saves + save_sync (applied, kept in step with this branch)
```

`window.RR.step(n)` and `window.RR.makeAllCPU()` exist for automated testing.
