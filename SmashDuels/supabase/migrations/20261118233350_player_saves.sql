/* ============================================================
   Rift Rumble — cloud saves: the save row

   One row per player, keyed by the auth user.  The whole local save blob
   (unlocks, coins, stats, records, challenges, settings) lives in `data`, so a
   new save field never needs a migration — only the sync contract below does.

   `rev` is the revision the client last saw.  Every write goes through
   public.save_sync (next migration), which only accepts a push at the revision
   the row currently holds.  That single guard is what stops two devices open at
   the same time from silently overwriting each other.
   ============================================================ */

create table if not exists public.player_saves (
  owner       uuid primary key references auth.users (id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  rev         bigint not null default 1,
  device      text,
  app_version text,
  updated_at  timestamptz not null default now()
);

alter table public.player_saves enable row level security;

/* A player touches exactly their own row, and only through auth.uid().  Table
   privileges are Supabase's defaults (anon/authenticated/service_role have DML
   on public tables); these policies are the actual boundary, so they must stay. */
drop policy if exists player_saves_select_own on public.player_saves;
create policy player_saves_select_own on public.player_saves
  for select to authenticated
  using (auth.uid() = owner);

drop policy if exists player_saves_insert_own on public.player_saves;
create policy player_saves_insert_own on public.player_saves
  for insert to authenticated
  with check (auth.uid() = owner);

drop policy if exists player_saves_update_own on public.player_saves;
create policy player_saves_update_own on public.player_saves
  for update to authenticated
  using (auth.uid() = owner)
  with check (auth.uid() = owner);

drop policy if exists player_saves_delete_own on public.player_saves;
create policy player_saves_delete_own on public.player_saves
  for delete to authenticated
  using (auth.uid() = owner);

comment on table public.player_saves is
  'Rift Rumble cross-device save blob, one row per auth user. Written only via public.save_sync.';
comment on column public.player_saves.rev is
  'Revision. The client sends the revision it last saw; a push at any other revision is rejected with the stored row so the two can be merged.';
comment on column public.player_saves.device is
  'Browser/OS tag of whichever device wrote last, for the settings panel only.';
