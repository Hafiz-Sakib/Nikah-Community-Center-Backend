-- Migration 003 — unpaid bookings now auto-cancel after 48 hours (was 72 h / 3 days).
-- Run once in Supabase → SQL Editor on an EXISTING database. (A fresh database gets this from schema.sql.)
-- Also set HOLD_HOURS=48 in the API environment (Render) — 48 is the new default.
--
-- A booking that has a submitted payment (bKash / Nagad / bank / card transaction ID) waiting for admin
-- verification is never auto-cancelled: expire_stale_holds() already skips it. That function is unchanged.

-- Bookings still waiting for payment get the shorter window, counted from when they were created.
-- Anything already older than 48 h keeps a 12 h grace period so nobody loses a date the moment you run this.
update public.bookings
   set hold_expires_at = least(hold_expires_at, greatest(created_at + interval '48 hours', now() + interval '12 hours'))
 where status = 'pending' and paid_amount = 0 and hold_expires_at is not null;
