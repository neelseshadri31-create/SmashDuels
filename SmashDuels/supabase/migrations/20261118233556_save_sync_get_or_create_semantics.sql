/* ============================================================
   Rift Rumble — cloud saves: the sync RPC (the live definition)

   The client (game/js/cloud.js) makes exactly one call, with four JSON keys that
   PostgREST maps onto these argument names:

     POST /rest/v1/rpc/save_sync
     { "p_data": {...}, "p_rev": 0, "p_device": "chrome/mac", "p_version": "v1" }
     -> [ { "rev": 1, "updated_at": "...", "data": {...}, "applied": true } ]

   Semantics, all four cases:

     p_rev is null      pull without writing. No save yet -> rev 0, data null,
                        applied false.  Deliberately does NOT create a row: a
                        player who only ever opens the title screen on a new device
                        must not end up with an empty save shadowing their real one
                        (this is what the first version got wrong).
     p_rev = 0, no row  first write from this player. Creates the row at rev 1 and
                        reports applied true.
     p_rev = stored rev accepted. Data replaced, rev bumped, applied true.
     p_rev = stale rev  rejected. The stored row comes back with applied false and
                        the client merges and retries once, so a second device's
                        progress is never silently discarded.

   Runs as the caller (security invoker) so the RLS policies in
   20261118233350_player_saves.sql are what actually decide access — an
   authenticated user can only ever read or write the row whose owner is
   auth.uid().  Keep it that way: `security definer` here would bypass RLS.
   ============================================================ */

/* The result columns are declared as a TABLE, not as OUT parameters.  Both spell
   the same four fields, but they cannot both appear: `RETURNS TABLE` plus an
   `out` argument is a hard syntax error (42601 "OUT and INOUT arguments aren't
   allowed in TABLE functions") — and it is exactly what pg_get_functiondef()
   prints for this function, so dumping the live definition and pasting it back
   gives a file that will not apply.  Keep the TABLE form. */
create or replace function public.save_sync(
  p_data jsonb,
  p_rev bigint,
  p_device text,
  p_version text
)
 returns table (rev bigint, updated_at timestamptz, data jsonb, applied boolean)
 language plpgsql
 set search_path to 'public'
as $function$
declare cur public.player_saves%rowtype;
begin
  if auth.uid() is null then
    raise exception 'save_sync: no authenticated user';
  end if;

  select ps.* into cur from player_saves ps where ps.owner = auth.uid();

  if cur.owner is null then
    if p_rev is not null and p_rev = 0 then
      begin
        insert into player_saves as ps (owner, data, rev, device, app_version)
          values (auth.uid(), coalesce(p_data, '{}'::jsonb), 1, p_device, p_version)
          returning ps.* into cur;
        return query select cur.rev, cur.updated_at, cur.data, true;
        return;
      exception when unique_violation then
        -- another device got there first: hand its row back to merge
        select ps.* into cur from player_saves ps where ps.owner = auth.uid();
        return query select cur.rev, cur.updated_at, cur.data, false;
        return;
      end;
    end if;
    return query select coalesce(cur.rev, 0)::bigint, cur.updated_at, cur.data, false;
    return;
  end if;

  if p_rev is null then
    return query select cur.rev, cur.updated_at, cur.data, false;
    return;
  end if;

  if p_rev = cur.rev then
    update player_saves as ps
       set data = coalesce(p_data, ps.data),
           rev = ps.rev + 1,
           device = coalesce(p_device, ps.device),
           app_version = coalesce(p_version, ps.app_version),
           updated_at = now()
     where ps.owner = auth.uid() and ps.rev = p_rev
       returning ps.rev, ps.updated_at, ps.data
       into cur.rev, cur.updated_at, cur.data;
    return query select cur.rev, cur.updated_at, cur.data, true;
    return;
  end if;

  return query select cur.rev, cur.updated_at, cur.data, false;
end;
$function$;

/* The client always sends all four keys; this overload keeps a hand-written call
   (or an older build) without p_version working. */
create or replace function public.save_sync(p_data jsonb, p_rev bigint, p_device text)
 returns table (rev bigint, updated_at timestamptz, data jsonb, applied boolean)
 language sql
 set search_path to 'public'
as $function$
  select * from public.save_sync(p_data, p_rev, p_device, null::text);
$function$;

/* Only the API roles, and only through the Data API: `public` would let any
   role in the cluster call it, and the anon key is public in a browser anyway. */
revoke all on function public.save_sync(jsonb, bigint, text, text) from public;
revoke all on function public.save_sync(jsonb, text, text) from public;
grant execute on function public.save_sync(jsonb, bigint, text, text) to anon, authenticated;
grant execute on function public.save_sync(jsonb, text, text) to anon, authenticated;

comment on function public.save_sync(jsonb, bigint, text, text) is
  'Rift Rumble save sync. RPC via POST /rest/v1/rpc/save_sync with keys p_data, p_rev, p_device, p_version. Rev-guarded: a push at a revision other than the stored one is rejected and the stored row is returned for merging.';
comment on function public.save_sync(jsonb, text, text) is
  'save_sync without p_version, for hand-written calls and older clients.';
