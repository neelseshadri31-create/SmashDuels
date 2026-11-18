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
