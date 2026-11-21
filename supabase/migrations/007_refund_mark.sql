-- Migration 007 — staff can mark a cancelled booking's money as refunded; a cancelled booking can then be deleted for good.
-- Run once in Supabase → SQL Editor on an EXISTING database. (A fresh database gets this from schema.sql.)
-- Money that was paid on a booking that got cancelled must be paid back by staff. These columns record that it was.
-- The API refuses to delete a cancelled booking while verified money has not been marked as refunded.

alter table public.bookings add column if not exists refunded_at timestamptz;
alter table public.bookings add column if not exists refunded_amount int;
