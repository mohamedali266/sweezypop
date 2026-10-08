alter table profiles
  add column if not exists must_change_password boolean default false,
  add column if not exists temporary_password_issued_at timestamptz,
  add column if not exists password_changed_at timestamptz;

drop policy if exists "Users can read own profile" on profiles;

create policy "Users can read own profile"
on profiles for select
using (auth_user_id = auth.uid() and active = true);
