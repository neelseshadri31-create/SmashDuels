/* save_sync, third cut.

   A real bug, not a feature: the OUT parameters (rev, updated_at, data, applied)
   share names with columns of player_saves, so inside `update player_saves set
   rev = rev + 1 ...` Postgres raised 42702 "column reference is ambiguous" and
   the function failed as soon as anyone pushed.  Fixed by aliasing the target
   (update player_saves as ps) and qualifying every column reference.  Anyone
   editing the function body must keep the aliases: the error only shows up on the
   write path, so a read-only test passes without it.

   Superseded in place; see 20261118233556 for the body that is live.  Nothing to
   run: this file exists so the repo's file list matches the project's migration
   history. */
