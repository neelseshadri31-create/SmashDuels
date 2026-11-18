/* save_sync, first cut.

   Added the sync RPC and spelled out what each argument combination means,
   because "push my save" and "give me the current save" share one entry point:

     p_data, p_rev = null   read only, never writes
     p_rev = 0              no save yet on the server, this is the first write
     p_rev = stored rev     accepted, revision bumps
     p_rev = stale rev      rejected, the stored row comes back to be merged

   The text of this step was iterated on in the same session and the final body
   lives in 20261118233556_save_sync_get_or_create_semantics.sql, which is the
   only file here that defines the function.  Nothing to run: this file exists so
   the repo's file list matches the project's migration history. */
