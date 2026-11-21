-- Migration 006 — database-level guard for booking status (last line of defence behind the API).
-- Run once in Supabase → SQL Editor on an EXISTING database. (A fresh database gets this from schema.sql.)
--
--   1. A Cancelled / Expired booking can never go back to Pending, Confirmed or Completed.
--   2. A booking can only become Confirmed when its VERIFIED payments cover its advance.
-- The API already enforces both (src/services/statusRules.js); this trigger stops anything that bypasses it
-- (two requests at the same moment, a manual SQL edit, a future code path).
-- Bookings that are ALREADY confirmed are not touched; the check only runs when the status changes.

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
