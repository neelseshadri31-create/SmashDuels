# Cloud saves — Supabase

Optional cross-device sync for Rift Rumble: unlocks, Rift Coins, lifetime stats,
records and completed challenges follow the player between devices. The local
`localStorage` save stays the source of truth while playing; this backend only
mirrors it.

The client is [`game/js/cloud.js`](../game/js/cloud.js) — no SDK, no build step,
three HTTP calls. The database holds the conflict rules, in
[`migrations/`](migrations).

## Bring up a project

1. Create a project at <https://supabase.com/dashboard> (any free region).
2. Apply the migrations, in filename order:

   ```bash
   supabase link --project-ref <ref>
   supabase db push          # applies supabase/migrations/*.sql in filename order
   ```

   Or paste each file into the dashboard SQL editor, oldest first.

   `migrations/20261118233350_player_saves.sql` and
   `migrations/20261118233556_save_sync_get_or_create_semantics.sql` are the only
   two that contain statements; the three between them document steps that were
   reworked inside the newest file and exist so the folder matches the project's
   migration history.
3. **Authentication → Sign In / Providers → Anonymous: enable it.** Without it a
   new player has no user id to own a save row, and the client reports
   `anonymous sign-ins are disabled on the project`. The dashboard is the only
   place that toggle lives — it is not settable through the management API.
4. Copy the **publishable key** (API Keys → Publishable) and the project URL.
   They are client-side values by design; nothing secret is needed here, because
   row-level security already restricts every player to their own row.

Then open the game → **RECORDS → CLOUD SAVES**, paste both values, and turn it on.
Settings live in `localStorage` (`rift-rumble-cloud-v1`), not in the repo — keep
it that way so a project ref never ends up in git.

## What is stored

```
public.player_saves
  owner        uuid  → auth.users(id), primary key, on delete cascade
  data         jsonb the whole save blob, verbatim
  rev          bigint revision guard
  device       text  "chrome/mac", written by the client
  app_version  text
  updated_at   timestamptz
```

One row per player, `data` untyped on purpose: a new save field costs no
migration. Deleting a user deletes their save (`on delete cascade`).

## The sync contract

`POST /rest/v1/rpc/save_sync` with `{ p_data, p_rev, p_device, p_version }`:

| call | result |
| --- | --- |
| `p_rev: null` | read only, never writes — `applied false` |
| no save yet, `p_rev: 0` | row created at `rev 1`, `applied true` |
| `p_rev` = stored `rev` | written, `rev + 1`, `applied true` |
| `p_rev` stale | rejected, `applied false` **plus the stored row** |

On a rejection the client merges and retries once; if the other device has moved
again in the meantime it keeps the merged save locally and pushes with the next
change rather than looping.

Merge is monotonic by design, so a device that has been offline for a week can
never roll progress back: coins and match counts take the max, unlocks and
completed challenges take the union, `records` take the max **except** best times
(`targetsBest`), which take the min. `settings` stay per device — a phone with the
music off should not turn it on everywhere.

## Deliberate limits

No realtime, no leaderboard, no `matches` table, no server-side anti-cheat: a
player with the publishable key and a session can rewrite their own save, which
is fine for a local-versus browser game and would need a different design to fix.
Every failure path is inert — offline, wrong key, project paused, a 500 — the
game plays on with the local save and the panel just says what happened.

## Checks

```bash
node tools/cloudtest.js     # merge direction, conflicts, retries, offline, expired token
node tools/simtest.js
node tools/atlascheck.js
```

`cloudtest.js` runs the module against a stub `fetch` that speaks the same
protocol as the Postgres function, so it covers both sides of the wire without a
project. Keep the two in step: it is the only automated check on the merge rules.
