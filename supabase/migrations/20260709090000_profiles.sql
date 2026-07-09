-- MathBoard access control — login-gated app, teacher-managed accounts.
-- No payments yet: active_until is set manually by the admin; a future payment
-- gateway only needs to extend this column (see docs/PAYMENTS-LATER.md).
-- Run: supabase db push  (or paste into the Supabase SQL editor)

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'student' check (role in ('admin', 'student')),
  full_name text not null default '',
  phone text not null default '',
  active_until timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- Security-definer helper so RLS policies can ask "is the caller an admin?"
-- without recursing into profiles' own policies.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "profiles_admin_insert" on public.profiles;
create policy "profiles_admin_insert" on public.profiles
  for insert with check (public.is_admin());

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_delete" on public.profiles
  for delete using (public.is_admin());

-- New Supabase projects no longer auto-expose tables to API roles.
grant select, insert, update, delete on public.profiles to authenticated;
