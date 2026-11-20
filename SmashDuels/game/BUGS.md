# RIFT RUMBLE — BUG CHECKLIST

Status legend: [ ] open · [x] fixed · [~] verified

---

## A. CONTROLS

- [~] A1. Up-tap (W) triggers BOTH a jump and an up-tilt/up-smash aim — input conflict
- [~] A2. Up-tap jump fires even when the player is aiming an up attack
- [~] A3. P2 numpad bindings dead on keyboards without a numpad / NumLock off
- [~] A4. `INPUT.pressed` never cleared while paused → stale attack fires on resume
- [~] A5. Attack buffered as `down` means holding F re-triggers after every action
- [~] A6. Shield → roll / spotdodge out of shield not reachable (order of checks)
- [~] A7. Grab button never checked before attack (attack wins)
- [~] A8. Crouch + attack produces dtilt but crouch state blocks it
- [~] A9. Fast-fall requires a fresh down-press but `downP` is consumed by crouch
- [~] A10. Ledge get-up: up/jump/attack/shield options not all reachable
- [~] A11. Dash attack unreachable (run state check uses stale vx)
- [~] A12. Short hop / full hop distinction missing
- [~] A13. No jump-squat, so aerials out of jump feel wrong
- [~] A14. Air dodge input not consumed correctly (shield held)
- [~] A15. Keyboard focus loss leaves keys stuck down

## B. ANIMATION

- [x] B1. Fighters use a single static frame — no walk/run/idle cycles
- [x] B2. No attack animation (static pose during swings)
- [x] B3. No hurt/hitstun reaction animation
- [x] B4. No shield animation
- [x] B5. Facing direction wrong for some fighters (`artFacing` per char)
- [x] B6. No jump/fall pose
- [x] B7. Sprite does not flip when turning on the spot mid-action
- [x] B8. Land animation missing (squash only, no frames)

## C. PLACEMENT ON MAP

- [x] C1. Spawn positions place fighters off-stage or inside platforms
- [x] C2. Fighters can spawn overlapping each other
- [x] C3. Platform landing check is too strict — pass-through platforms unreliable
- [x] C4. Walking off a platform does not transition to fall
- [x] C5. Clamping fighters inside stage footprint fights the blast-zone KO
- [x] C6. Respawn platform position not at stage centre
- [x] C7. Camera initial framing wrong / zoomed into a corner
- [x] C8. Fighters can clip through the underside of the main platform
- [x] C9. Moving platforms do not carry riders

## D. ATTACK DAMAGE / INCREMENTOR

- [x] D1. Damage % on HUD does not increment on hit
- [x] D2. Hitbox AABB uses wrong origin when facing left
- [x] D3. `checkHit` hit-id set blocks multi-hit moves entirely
- [x] D4. Smash charge multiplies damage twice
- [x] D5. Knockback formula can produce NaN at 0 weight / 0 damage
- [x] D6. Damage% caps display but HUD text not refreshed while charging
- [x] D7. Attacks pass through shielding opponents without shield damage
- [x] D8. Projectile damage does not count toward stats
- [x] D9. No damage on the very first frame of the active window
- [x] D10. Counter/reflect does not return damage

## E. GENERAL / OTHER

- [x] E1. Uncaught exceptions in any mode
- [x] E2. Results screen stats incorrect
- [x] E3. Item pickup radius too small / items unreachable
- [x] E4. Pause does not stop the render loop cleanly
- [x] E5. Audio unlocking on first gesture
- [x] E6. Mobile touch controls not wired
- [x] E7. Save data quota errors
- [x] E8. `Modes.current` leaks between matches

## F. FOUND DURING VERIFICATION (this pass)

- [x] F1. `update()` threw on any fighter that had not yet received input (`this.input` undefined) — crashed 4-player matches
- [x] F2. Charge-swing state machine froze `actionT` at `startup-1`: charged smashes never released, so fsmash/usmash/dsmash dealt **0 damage** in play
- [x] F3. Knockback was hard-capped at 62 → damage% stopped mattering above ~35%, so nothing could be KO'd at high percent
- [x] F4. Knockback units were unscaled to stage size → every hit crossed the blastzone (KO at any percent)
- [x] F5. A fighter deep under the main platform was snapped up onto its surface (C8 clipping)
- [x] F6. Respawn teleported everyone to x=0 and could land on a soft platform above the stage
- [x] F7. Sprite height was inconsistent across the roster (Grim 1.6× too large, Vesper/Rook too small)
- [x] F8. **Every special move was dead**: `startSpecial` overwrote `action.type` with `'special'`, so all `sp.type === 'projectile' / 'dash' / 'recover' / 'counter'` branches were unreachable — no projectiles, no rushes, no recoveries
- [x] F9. Single-frame special triggers (`t === startup`) never fired because the timer increments before the check — now latched with one-shot flags
- [x] F10. Camera zoomed in far too tight (1.42× max) so the stage deck overflowed the screen and fighters appeared mis-placed relative to it — reframed to fit the deck (0.42–1.06×)
- [x] F11. Consecutive attacks blocked: `hitIds` was only reset on a *new* attack, so any second swing in the same action whiffed
- [x] F12. Holding attack never returned to idle (auto-repeat removed; one press = one move, rapid taps chain)
- [x] F13. Camera framing verified across all six stages

## G. SECOND PLAYTEST REPORT (user: "animations flickering back and forth", "characters falling through the ground")

- [x] G1. **Fighters fell through the ground during Final Smash** — `updateFinalSmash` did raw `y += vy` with zero stage collision while leaving `onGround = true`, so the fighter sank ~3px/frame through the deck for the whole ~150-frame move. Measured 298 underground frames in one match; now 0 across all 6 stages.
- [x] G2. **Idle animation visibly flickered** — the "breathing" alternated between two *different* drawings (frames 0 and 1) every 34ms. Idle now holds one pose; the breath is a sine bob applied at draw time.
- [x] G3. **Run cycle read as a 2-frame strobe** — `[2,4,2,5]` bounced between two poses ~18x/sec. Now a 3-pose stride `[2,4,5,4]` at a readable cadence.
- [x] G4. **Impact squash flickered** — a hard threshold on `hitlag>6`/`flashT>3` toggled scale on and off per frame. Replaced with a smooth continuous factor.
- [x] G5. **Shield was a sprite-wide `shadowBlur` glow** — on Grim's large detailed sprite this blew out into a fireball that hid the fighter entirely and looked like a rendering glitch. Replaced with a proper radial shield dome + rim, drawn after the sprite.

## H. THIRD PLAYTEST REPORT (user: "the animation states are still not correct… they feel very slow, movement seems scuffed, it doesn't hitbox correctly")

- [x] H1. **Pose and tick could disagree** — the animation clock read wall time, so hitlag, a pause or a slow frame slid the drawn pose out from under the tick that decided the hit. `Sprites.clockFor` is keyed on `animT` (one frame lookup per tick, `d <= 0` resets, hitlag freezes the pose) and asserted both ways.
- [x] H2. **Heavy attacks read as a still image that suddenly has a weapon in it** — 37 of 65 attack rows are 1–2 tiles on these sheets, so tick 0 of a smash already showed the finished crescent. Attack frames are now phase-gated: the wind-up holds the anticipation tile with its baked effect faded in (`vfxGate`), the strike tile exists for exactly the live window, recovery steps back out, and a coil → throw lean + squash-stretch (`attackSwing`) supplies the motion the sheets never drew.
- [x] H3. **Walk and run looked like skating** — cycles advanced on a fixed counter, so a light fighter strobed while a heavy one slid. Locomotion is stride-driven (ground px per frame: walk 14, run 17) and does not advance below `STALL_PX` = 0.45 px/tick, which also removes the walk cycle at zero speed.
- [x] H4. **A reversal was a moonwalk** — turning around kept the run cycle playing backwards. Above `walk × 1.15` a reversal now braces (`SKID_FRAMES`), scrubs `vx` at `traction × 3.1`, plays a single planted pose with dust and a quiet land cue, and takes the dash away.
- [x] H5. **A fresh tap did nothing and the `dash` row never played** — taps are detected, a fresh tap gives a real burst off the mark (`run × 0.28`) and arms the run, the `dash` row plays while `dashT > 0`, and releasing input / jumping / attacking / rolling disarms.
- [x] H6. **Hitboxes were bigger than the animation** — art was allowed to grow a box on *every* edge, so a smash's trailing crescent (painted up over the head) turned Valor's 60px-tall side-smash rectangle into 138px and Grim's into 222px: a *forward* smash that reversed anyone standing above you. Growth is now along the blow axis only, capped at 0.85 of a drawn body-height, never backwards and never across the band.
- [x] H7. **The hurtbox counted baked VFX as a limb** — mid-swing a fighter was vulnerable across the whole effect sweep (Valor's smash: a 220px-wide hurtbox). The vulnerable box measures the figure alone (`bodyBox`), still extends where the body lunges, and can never be wider than what that same tick draws.
- [x] H8. **Merged filmstrips were painted whole, every tick** — 13 rows across the roster came out of the slicer as a single 165–260px tile holding two overlapping poses: visibly broken, and unusable for geometry. `tools/atlas_desmerge.py` re-cuts them out of the shipped atlas PNG (tight horizontal crops, one shared baseline, no re-slice, `--check`/`--revert`); moves running on an authored fallback went **4 → 1**.
- [x] H9. **Timing budget is now enforced, not hoped for** — families retimed for snappiness (`jab 1.00/0.60/12f … smash 1.00/0.60/26f`, dash tail 0.56, aerial landing lag derived from weight), exact `t0/t1` per-box active windows with a re-arm for multi-hits, and asserts for ≤47f smash / ≤34f other, ≥4f recovery, ≥2f startup, jab ≤18f.
- [ ] H10. **`grim.dsmash` is still one continuous drawing** — the profile has no seam the tool will defend, so it keeps its authored rectangle and its merged tile. Needs the sheet redrawn (LOG-14), not the engine.
- [x] H11. **Needs eyes in a browser** — how the pivot, dash burst and new frame data *feel* at speed was a playtest question; `node tools/film.js && python3 tools/film_render.py` now also answers the smoothness half of it without a browser (stuck-frame audit, §I6). The playtest that came back is section I.

## I. FOURTH PLAYTEST REPORT (user: "in vs-4 the fighters get stuck at the sides", "collision problems with blocks and things", "animations are not fluid, running feels laggy")

- [x] I1. **A CPU holding a batter hit every frame the button was held** — `Match.useHeld` (the AI's own item path, `ai.js → useItemOrThrow`) had no recovery of any kind: 60 swings in 60 ticks was 60 hits and 660% on the victim, and every one of those hits refreshed hitlag, so the two of them stood there hitting each other until the round ended — 519 hits inside one 903-frame lock on Rune Range, and the "stuck at the side" complaint in another costume. A swing is now one hit per `ITEM_SWING` = 24 ticks, the same recovery a player pays for pressing attack while holding an item.
- [x] I2. **A multi-hit move could juggle-lock both fighters** — hitlag freezes `actionT`, `active` is counted in `actionT`, and `rehitBlocked` only asks for a few ticks of gap, so Vesper's two-hit Dagger Flurry re-armed itself forever against a target that could not escape its own hitlag. A move now spends at most its authored hit count (`1 + multi`) on one target per action: the flurry still lands both hits, and never a third.
- [x] I3. **A fighter that landed from a tumble stayed in `hitstun`** — the stale-state cleanup covered `launch` only, so a body that came down with no hitstun left kept the tumble animation *and* the 0.995 air drag instead of ground friction: 545 frames (9 seconds) lying on the deck sliding a third of a pixel a tick, until a stray hit moved it on. The tick after hitstun ends, grounded or airborne, it gets up.
- [x] I4. **A grab could hold an opponent for as long as the grabber liked** — the auto-throw read `if (t >= 60)` where `t` was the grabbed *fighter*, not a timer, so the comparison was always false and there is no mash-out in this engine. `grabT` is the hold clock now, and a pummel deliberately does not restart it: a grab ends in a forward throw after `GRAB_HOLD_MAX` = 120 ticks.
- [x] I5. **Hazards re-hit every tick they touched you** — a lava pool billed `hz.dmg` every frame you stood in it, and the bamboo beam was tested on all 60 ticks it was up, so the pillar's whole damage budget landed ten times over and re-launched you on each tick: you never left the pillar, the pillar juggled you off the stage. Hazards now share a `HAZARD_REHIT` = 45-tick re-arm per fighter (`f.hazardCD`) and the beam arms one hit per fighter per appearance (`Match.pillarActive/pillarHit`, cleared at the start of a cycle). Measured on the beam: 10% per 420-tick cycle, was 20%+ and a launch per tick.
- [x] I6. **The crowd pinned itself against the sides in 4-player** — `separateFighters` applied a push, `Fighter.confine` undid it, and the solver applied the same push again; three passes of an argument at 50/50 weight is a vibration, not a resolution. The solver now asks each body how much room it actually has (`room()`, same `DECK_LIP` the ground test uses), gives an immobile body's share to the neighbour that can move, lets a fighter with a direction held resist being shoved backwards (`drive` 1.8×), and `confine` eases a shallow slab overlap out at `SLAB_EASE` px/tick instead of teleporting the body 24px into the void. A packed edge pile escapes in 66 ticks holding away (was: never) and an idling one is no longer shoved off the deck.
- [x] I7. **Ledge hangs did not end** — a fighter shoved to the underside of the deck lip hung until it pressed a button, which a CPU 4-player pile never does. Capture needs `beyond ∈ [LEDGE_OUTSIDE, 34]` (a body still standing on the lip is not hanging), and `LEDGE_AUTO_CLIMB` = 72 ticks of doing nothing get you up on their own. Worst hang in a 2400-tick CPU match: 47 ticks (was: 216+ and still climbing).
- [x] I8. **Moving platforms dropped you / left you floating** — a fighter riding the Ember Foundry lift or a Comet Reach block did not inherit its travel, so the deck slid out from under them, and a descending block left them airborne for a tick, then snapped them back: a one-frame bounce every time a platform changed direction. Platforms carry `p.dx/p.dy` and `applyPhysics` rides them before the stage test; items (`Item.onPlatform`) and the deck lip they land on got the same treatment.
- [x] I9. **Running looked laggy because 120 Hz was drawing each tick twice** — the sim is a fixed 60 Hz step and the draw took whatever the last whole tick produced, so a 120 Hz panel showed every other frame twice: `tools/film.js --hz=120 --blend=0` counts 13 stuck frames across a walk row, 13 across a run, 25 of 26 across idle. The renderer now leads each drawn frame into the next tick (`Sprites.beginFrame(match, alpha)`, `ui.js` passes the accumulator fraction; camera and items lead too), gated so a pose never runs ahead of travel the sim actually made (`LEAD_CAP` 4px, an impulse above 1.25px/tick cancels the lead, hitlag skips it). Stuck frames: run 13 → 0, idle 25 → 0, and at 144 Hz the count of frames drawn at an unchanged x falls 143 → 9. **No new spritesheet was needed**: the judder was a draw-rate problem, and the source rows only carry 6–8 cells each (the merged ones cannot be split further — `tools/slice_roster.py` finds one ink run per row), so re-slicing would have bought wider animation, not smoother motion.
- [x] I10. **`frameDt` jitter made the lead wobble** — the loop's frame delta is now smoothed (`frameDt += (dt - frameDt) × 0.1`) and a hitch over 1.3 steps drops the alpha instead of teleporting the world.
- [ ] I11. **Still open, on purpose**: two *airborne* fighters pressed into a side wall keep overlapping (51 of 240 probe ticks past 30px) because letting the solver push an airborne body past the deck lip toward the blast line would separate them into a KO. They sort themselves out on landing. If a future playtest calls this out, the fix is a vertical nudge, not more horizontal room.
