/* save_sync, second cut.

   Grew a fourth argument, p_version, so the save blob can be tagged with the
   build that wrote it.  Without it a save written by a future version of the
   game is indistinguishable from a stale one, and there is nothing to migrate
   from later.  PostgREST maps JSON keys to argument names, so the client body is
   { p_data, p_rev, p_device, p_version } — renaming an argument is a breaking
   API change for the client.

   Superseded in place; see 20261118233556 for the body that is live.  Nothing to
   run: this file exists so the repo's file list matches the project's migration
   history. */
