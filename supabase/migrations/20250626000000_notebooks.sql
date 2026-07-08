-- MathBoard cloud sync — notebooks table (Phase 7)
-- Run in Supabase SQL editor or: supabase db push

-- MathBoard notebook ids are short strings (not UUIDs), e.g. "m5abc12xyz".
create table if not exists public.notebooks (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  json jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists notebooks_owner_updated
  on public.notebooks (owner_id, updated_at desc);

-- Keep updated_at fresh on every write.
create or replace function public.set_notebooks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notebooks_set_updated on public.notebooks;
create trigger notebooks_set_updated
  before update on public.notebooks
  for each row execute function public.set_notebooks_updated_at();

alter table public.notebooks enable row level security;

-- One policy per operation (USING + WITH CHECK where needed).
drop policy if exists "notebooks_select_own" on public.notebooks;
create policy "notebooks_select_own" on public.notebooks
  for select using (owner_id = auth.uid());

drop policy if exists "notebooks_insert_own" on public.notebooks;
create policy "notebooks_insert_own" on public.notebooks
  for insert with check (owner_id = auth.uid());

drop policy if exists "notebooks_update_own" on public.notebooks;
create policy "notebooks_update_own" on public.notebooks
  for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "notebooks_delete_own" on public.notebooks;
create policy "notebooks_delete_own" on public.notebooks
  for delete using (owner_id = auth.uid());
