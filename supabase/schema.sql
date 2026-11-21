-- Nikah Community Center — database schema
-- Run once in Supabase → SQL Editor.

-- ============ profiles ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  phone text,
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ bookings ============
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  user_id uuid not null references public.profiles(id),
  status text not null default 'pending'
    check (status in ('pending','confirmed','cancelled','expired','completed')),
  event_type text not null,
  package_id text not null,
  shift text not null check (shift in ('morning','evening','full')),
  booking_date date not null,
  guests int not null check (guests between 20 and 2000),
  addons text[] not null default '{}',
  catering text not null default 'own' check (catering in ('own','hall')),
  menu_id text,
  contact_name text not null,
  contact_phone text not null,
  contact_email text,
  notes text,
  price_snapshot jsonb not null,
  total int not null check (total >= 0),
  advance int not null check (advance >= 0),
  paid_amount int not null default 0,
  hold_expires_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  refunded_at timestamptz,        -- set when staff paid the verified money back after a cancellation (migration 007)
  refunded_amount int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- time window of the shift (must match SHIFTS in the frontend)
  during tsrange generated always as (
    case shift
      when 'morning' then tsrange(booking_date + time '10:00', booking_date + time '15:00')
      when 'evening' then tsrange(booking_date + time '17:00', booking_date + time '22:30')
      else               tsrange(booking_date + time '10:00', booking_date + time '22:30')
    end
  ) stored,

  -- THE rule: two active bookings can never overlap. 'full' overlaps both morning and evening.
  constraint no_double_booking
    exclude using gist (during with &&)
    where (status in ('pending','confirmed','completed'))
);
-- If the generated column errors on your Postgres version, replace it with a plain tsrange column
-- + a BEFORE INSERT OR UPDATE trigger that sets it. Keep the exclusion constraint as is.

create index bookings_user_idx   on public.bookings (user_id, booking_date desc);
create index bookings_date_idx   on public.bookings (booking_date);
create index bookings_status_idx on public.bookings (status);

-- ============ payments ============
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  amount int not null check (amount > 0),
  method text not null check (method in ('bkash','nagad','bank','office','card')),
  reference text,
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  note text,
  submitted_by uuid references public.profiles(id),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index payments_booking_idx on public.payments (booking_id);

-- ============ audit log ============
create table public.booking_events (
  id bigint generated always as identity primary key,
  booking_id uuid references public.bookings(id) on delete cascade,
  actor_id uuid,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- ============ updated_at ============
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger t_profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger t_bookings_touch before update on public.bookings for each row execute function public.touch_updated_at();

-- ============ expire unpaid holds ============
-- A pending booking holds its slot for HOLD_HOURS (default 48 h, set in the API .env).
-- When hold_expires_at passes and there is NO verified payment AND NO submitted payment waiting for admin review,
-- the booking is auto-cancelled (status = 'expired') and the date/shift is free again.
-- It runs lazily on every availability / booking-list / create call, so no cron job is required.
create or replace function public.expire_stale_holds()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with gone as (
    update public.bookings b
       set status = 'expired',
           cancelled_at = now(),
           cancel_reason = 'Auto-cancelled: advance not paid in time'
     where b.status = 'pending' and b.paid_amount = 0 and b.hold_expires_at < now()
       and not exists (select 1 from public.payments p where p.booking_id = b.id and p.status = 'pending')
    returning b.id, b.booking_date, b.shift
  ), logged as (
    insert into public.booking_events (booking_id, actor_id, action, detail)
    select id, null, 'auto_expired', jsonb_build_object('date', booking_date, 'shift', shift) from gone
    returning 1
  )
  select count(*) into n from logged;
  return n;
end $$;
revoke execute on function public.expire_stale_holds() from public, anon, authenticated;
grant  execute on function public.expire_stale_holds() to service_role;

-- ============ RLS: deny everything to browser clients ============
alter table public.profiles       enable row level security;
alter table public.bookings       enable row level security;
alter table public.payments       enable row level security;
alter table public.booking_events enable row level security;
-- No policies on purpose. Only the Express API (service role) touches these tables.

-- ============ after you sign up once, make yourself admin ============
-- update public.profiles set role = 'admin' where email = 'YOUR_EMAIL';

-- ============ payment guard (migration 004) ============
create or replace function public.guard_payment_total()
returns trigger language plpgsql as $$
declare t int; others int;
begin
  if new.status = 'rejected' then return new; end if;
  select total into t from public.bookings where id = new.booking_id for update;
  select coalesce(sum(amount), 0) into others from public.payments
   where booking_id = new.booking_id and status <> 'rejected' and id <> new.id;
  if others + new.amount > t then
    raise exception 'Payments would exceed the booking total' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists t_payments_guard on public.payments;
create trigger t_payments_guard before insert or update of amount, status, booking_id on public.payments
  for each row execute function public.guard_payment_total();

-- ============ booking status guard (migration 006) ============
create or replace function public.guard_booking_status()
returns trigger language plpgsql as $$
declare v int;
begin
  if new.status = old.status then return new; end if;
  if old.status in ('cancelled','expired') then
    raise exception 'A cancelled booking cannot be confirmed or re-opened' using errcode = 'P0001';
  end if;
  if new.status = 'confirmed' then
    select coalesce(sum(amount), 0) into v from public.payments where booking_id = new.id and status = 'verified';
    if v < new.advance then
      raise exception 'A booking is confirmed only when its advance payment is verified' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists t_bookings_status_guard on public.bookings;
create trigger t_bookings_status_guard before update of status on public.bookings
  for each row execute function public.guard_booking_status();
