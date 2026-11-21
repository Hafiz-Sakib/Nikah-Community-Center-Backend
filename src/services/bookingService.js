import { supabase } from '../lib/supabase.js'
import { env } from '../config/env.js'
import { buildQuote } from '../config/pricing.js'
import { dhakaToday, addDays } from '../lib/dates.js'
import { httpError } from '../middleware/error.js'
import { toApi } from '../lib/mappers.js'
import { standing, paymentRows } from './paymentService.js'

const ACTIVE = ['pending', 'confirmed']
const newCode = () => 'NCC-' + Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, '0')
export const SLOT_TAKEN = 'Sorry, that date and shift was just booked by someone else'
const PRICE_KEYS = ['packageId', 'shift', 'date', 'guests', 'addons', 'catering', 'menu']

export const logEvent = (bookingId, actorId, action, detail) =>
  supabase.from('booking_events').insert({ booking_id: bookingId, actor_id: actorId, action, detail }).then(() => {}, () => {})

const cols = (i) => ({
  event_type: i.eventType, package_id: i.packageId, shift: i.shift, booking_date: i.date, guests: i.guests,
  addons: [...new Set(i.addons ?? [])], catering: i.catering, menu_id: i.catering === 'hall' ? i.menu : null,
  contact_name: i.name, contact_phone: i.phone, contact_email: i.email || null, notes: i.notes || null,
})

export async function createBooking(user, input, { forAdmin = false } = {}) {
  await supabase.rpc('expire_stale_holds')
  if (input.date < addDays(dhakaToday(), 1)) throw httpError(400, 'Please pick tomorrow or a later date')

  if (!forAdmin) {
    const { count } = await supabase.from('bookings').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('status', 'pending')
    if (count >= env.MAX_PENDING_PER_USER) throw httpError(429, 'You already have several unpaid bookings. Pay or cancel one first.')
  }

  const snap = buildQuote(input)                       // server-side price, client price ignored
  for (let i = 0; i < 5; i++) {
    const { data, error } = await supabase.from('bookings').insert({
      ...cols(input), price_snapshot: snap, total: snap.total, advance: snap.advance,
      code: newCode(), user_id: user.id,
      status: forAdmin ? 'confirmed' : 'pending',
      hold_expires_at: forAdmin ? null : new Date(Date.now() + env.HOLD_HOURS * 3600_000).toISOString(),
    }).select().single()
    if (!error) {
      await logEvent(data.id, user.id, forAdmin ? 'created_by_admin' : 'created', { shift: input.shift, date: input.date })
      return toApi(data)
    }
    if (error.code === '23P01') throw httpError(409, SLOT_TAKEN)   // exclusion_violation
    if (error.code === '23505') continue                           // code collision, retry
    throw error
  }
  throw httpError(500, 'Could not create booking')
}

export async function loadBooking(user, code, admin = false) {
  let q = supabase.from('bookings').select('*').eq('code', code)
  if (!admin) q = q.eq('user_id', user.id)
  const { data } = await q.maybeSingle()
  if (!data) throw httpError(404, 'Booking not found')   // 404 (not 403) so others' codes are not revealed
  return data
}

export async function updateBooking(user, code, patch, { admin = false } = {}) {
  const row = await loadBooking(user, code, admin)
  if (!admin) {
    if (!ACTIVE.includes(row.status)) throw httpError(409, `A ${row.status} booking can't be edited`)
    if (row.booking_date < addDays(dhakaToday(), env.EDIT_CUTOFF_DAYS))
      throw httpError(403, 'Too close to the event date to edit online. Please call us.')
  }
  const { status, ...fieldsPatch } = patch
  const cur = {
    eventType: row.event_type, packageId: row.package_id, date: row.booking_date, shift: row.shift,
    guests: row.guests, addons: row.addons, catering: row.catering, menu: row.menu_id,
    name: row.contact_name, phone: row.contact_phone, email: row.contact_email, notes: row.notes,
  }
  const next = { ...cur, ...fieldsPatch }
  if (!admin && next.date !== cur.date && next.date < addDays(dhakaToday(), 1)) throw httpError(400, 'Pick a future date')

  const update = { ...cols(next) }
  const priceChanged = PRICE_KEYS.some((k) => JSON.stringify(next[k] ?? null) !== JSON.stringify(cur[k] ?? null))
  if (priceChanged) {                                  // keep old snapshot when price inputs are untouched
    const snap = buildQuote(next)
    Object.assign(update, { price_snapshot: snap, total: snap.total, advance: snap.advance })
  }
  // A new date/shift needs the slot re-checked (the DB refuses a clash). Only a booking whose advance is NOT yet verified goes back on a 48 h hold;
  // a fully or sufficiently paid one stays confirmed. Changing package or guests never touches status: the total simply moves
  // and the balance (or a refund due, if the total fell below what was paid) shows up on the billing screens.
  const scheduleChanged = next.date !== cur.date || next.shift !== cur.shift
  if (!admin && row.status === 'confirmed' && scheduleChanged) {
    const adv = update.advance ?? row.advance
    const st = standing({ total: update.total ?? row.total, advance: adv }, await paymentRows(row.id))
    if (st.verified < adv) { update.status = 'pending'; update.hold_expires_at = new Date(Date.now() + env.HOLD_HOURS * 3600_000).toISOString() }
  }
  if (admin && status) {
    update.status = status
    if (status === 'cancelled') update.cancelled_at = new Date().toISOString()
    if (status === 'confirmed') update.hold_expires_at = null
    if (status === 'pending') update.hold_expires_at = new Date(Date.now() + env.HOLD_HOURS * 3600_000).toISOString()   // re-opened: fresh 3-day window, else it would expire again at once
    if (status === 'pending' || status === 'confirmed') Object.assign(update, { cancelled_at: null, cancel_reason: null })
  }

  const { data, error } = await supabase.from('bookings').update(update).eq('id', row.id).select().single()
  if (error?.code === '23P01') throw httpError(409, SLOT_TAKEN)
  if (error) throw error
  await logEvent(row.id, user.id, admin ? 'admin_updated' : 'updated', patch)
  return toApi(data)
}

export async function cancelBooking(user, code, reason, { admin = false } = {}) {
  const row = await loadBooking(user, code, admin)
  if (!ACTIVE.includes(row.status)) throw httpError(409, `Already ${row.status}`)
  if (!admin && row.booking_date < dhakaToday()) throw httpError(409, 'This event date has passed')
  const { data, error } = await supabase.from('bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_reason: reason ?? null })
    .eq('id', row.id).select().single()
  if (error) throw error
  await logEvent(row.id, user.id, admin ? 'admin_cancelled' : 'cancelled', { reason })
  return toApi(data)
}

/* sum verified payments -> paid_amount; auto-confirm when advance is covered */
export async function recomputePaid(bookingId, actorId) {
  const { data: pays, error: e1 } = await supabase.from('payments').select('amount').eq('booking_id', bookingId).eq('status', 'verified')
  if (e1) throw e1
  const paid = pays.reduce((s, p) => s + p.amount, 0)
  const { data: row, error: e2 } = await supabase.from('bookings').select('id,status,advance').eq('id', bookingId).single()
  if (e2) throw e2
  const update = { paid_amount: paid }
  if (row.status === 'pending' && paid >= row.advance) { update.status = 'confirmed'; update.hold_expires_at = null }
  const { data, error } = await supabase.from('bookings').update(update).eq('id', bookingId).select().single()
  if (error) throw error
  await logEvent(bookingId, actorId, 'payment_recomputed', { paid, status: data.status })
  return data
}

