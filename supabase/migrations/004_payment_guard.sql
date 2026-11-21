-- Migration 004 — database-level guard: payments can never add up to more than the booking total.
-- Run once in Supabase → SQL Editor on an EXISTING database. (A fresh database gets this from schema.sql.)
-- The API already checks this before every write; this trigger is the last line of defence when two
-- requests arrive at the same moment (two browser tabs, a double click, customer + staff together).
-- Rejected payments do not count. The booking row is locked while the check runs, so requests queue up one by one.

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
