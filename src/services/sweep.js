import { supabase } from '../lib/supabase.js'
import { dhakaToday, dhakaMinutesNow, eventHasEnded } from '../lib/dates.js'

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
/* A confirmed booking becomes Completed as soon as its shift is over (not the next day). Such an event is treated as a successful one.
   Money still owed stays visible on the booking (the customer can pay the balance later), so nothing is hidden. */
export async function completeFinished() {
  const today = dhakaToday(), nowMin = dhakaMinutesNow()
  const { data, error } = await supabase.from('bookings').select('id,booking_date,shift').eq('status', 'confirmed').lte('booking_date', today)
  if (error) throw error
  const ids = (data ?? []).filter((b) => eventHasEnded(b.booking_date, b.shift, today, nowMin)).map((b) => b.id)
  if (!ids.length) return 0
  const { error: e2 } = await supabase.from('bookings').update({ status: 'completed' }).in('id', ids).eq('status', 'confirmed')
  if (e2) throw e2
  await supabase.from('booking_events').insert(ids.map((id) => ({ booking_id: id, actor_id: null, action: 'auto_completed', detail: { reason: 'event_over' } }))).then(() => {}, () => {})
  return ids.length
}
export const sweepCompleted = gate(completeFinished, 30_000)
