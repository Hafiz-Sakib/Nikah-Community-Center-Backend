-- Migration 005 — the hall now holds up to 2000 guests (was 600), and each package has its own guest limit.
-- Run once in Supabase → SQL Editor on an EXISTING database. (A fresh database gets this from schema.sql.)
-- Per-package limits and which events a package is for are enforced by the API (src/config/pricing.js).

alter table public.bookings drop constraint if exists bookings_guests_check;
alter table public.bookings add constraint bookings_guests_check check (guests between 20 and 2000);
