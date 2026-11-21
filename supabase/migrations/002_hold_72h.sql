-- Migration 002 — unpaid bookings now auto-cancel after 3 days (was 24 h).
-- Run once in Supabase → SQL Editor on an EXISTING database. (A fresh database gets this from schema.sql.)
-- Also set HOLD_HOURS=72 in the API environment (Render) — 72 is the new default.

-- 1) smarter expiry: stores a reason + writes an audit row for every auto-cancel
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

-- 2) give bookings that are still waiting for payment the new 3-day window (counted from when they were created)
update public.bookings
   set hold_expires_at = created_at + interval '72 hours'
 where status = 'pending' and paid_amount = 0 and hold_expires_at is not null;
