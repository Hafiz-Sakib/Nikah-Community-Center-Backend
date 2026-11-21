import { supabase } from '../lib/supabase.js'
import { dhakaToday } from '../lib/dates.js'

/* Housekeeping that read-only endpoints (availability, lists, stats) trigger.
   Many browsers poll these at once, so the work is shared: one run at a time, and not more than once per `gap` ms.
   createBooking still calls expire_stale_holds directly, so a new booking always sees fresh data. */
const gate = (fn, gap) => {
  let last = 0, inflight = null
  return () => {
    if (inflight) return inflight
    if (Date.now() - last < gap) return Promise.resolve()
    inflight = Promise.resolve().then(fn).catch((e) => console.warn('[sweep]', e?.message)).finally(() => { last = Date.now(); inflight = null })
    return inflight
  }
}
export const sweepHolds = gate(() => supabase.rpc('expire_stale_holds'), 10_000)
export const sweepCompleted = gate(
  () => supabase.from('bookings').update({ status: 'completed' }).eq('status', 'confirmed').lt('booking_date', dhakaToday()), 60_000)
