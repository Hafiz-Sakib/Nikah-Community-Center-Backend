import { Router } from 'express'
import { supabase } from '../lib/supabase.js'
import { bookingInput, adminBookingPatch, adminPaymentInput, paymentReview, adminList, cancelInput } from '../schemas.js'
import { createBooking, updateBooking, cancelBooking, loadBooking, recomputePaid, logEvent } from '../services/bookingService.js'
import { toApi, toApiPayment } from '../lib/mappers.js'
import { dhakaToday, addDays } from '../lib/dates.js'
import { sweepHolds, sweepCompleted } from '../services/sweep.js'
import { httpError } from '../middleware/error.js'
import { paymentRows, assertRoom, assertFreshReference, mapPaymentDbError } from '../services/paymentService.js'

const r = Router()

// GET /admin/bookings?status=&q=&from=&to=&page=&pageSize=
r.get('/bookings', async (req, res) => {
  const f = adminList.parse(req.query)
  await sweepHolds()   // release unpaid holds so the list never shows an expired hold as pending
  await sweepCompleted()
  let q = supabase.from('bookings').select('*, payments(*), profiles(avatar_url)', { count: 'exact' })
  if (f.verify) {                                   // "To verify" queue: bookings with a submitted payment waiting for review
    const { data: waiting, error: ew } = await supabase.from('payments').select('booking_id').eq('status', 'pending')
    if (ew) throw ew
    const ids = [...new Set(waiting.map((x) => x.booking_id))]
    if (!ids.length) return res.json({ items: [], total: 0, page: f.page, pageSize: f.pageSize })
    q = q.in('id', ids)
  }
  // An unpaid booking that timed out is shown to everyone as "Cancelled", so the Cancelled filter covers both.
  if (f.status === 'cancelled') q = q.in('status', ['cancelled', 'expired'])
  else if (f.status) q = q.eq('status', f.status)
  if (f.from) q = q.gte('booking_date', f.from)
  if (f.to) q = q.lte('booking_date', f.to)
  if (f.q) {
    const t = f.q.replace(/[^\p{L}\p{N}+@._ -]/gu, '')       // keep it safe inside the or() filter
    if (t) q = q.or(`code.ilike.%${t}%,contact_name.ilike.%${t}%,contact_phone.ilike.%${t}%`)
  }
  const from = (f.page - 1) * f.pageSize
  const { data, count, error } = await q.order('booking_date', { ascending: false }).order('created_at', { ascending: false }).range(from, from + f.pageSize - 1)
  if (error) throw error
  // Walk-in bookings are created under the staff member's own account, so their photo must not be shown for the guest.
  const walkIn = new Set()
  if (data.length) {
    const { data: ev } = await supabase.from('booking_events').select('booking_id').eq('action', 'created_by_admin').in('booking_id', data.map((x) => x.id))
    for (const e of ev ?? []) walkIn.add(e.booking_id)
  }
  res.json({ items: data.map(({ payments, profiles, ...row }) => ({ ...toApi(row, payments), avatar: walkIn.has(row.id) ? null : (Array.isArray(profiles) ? profiles[0] : profiles)?.avatar_url ?? null })), total: count ?? 0, page: f.page, pageSize: f.pageSize })
})

// POST /admin/bookings  (walk-in)
r.post('/bookings', async (req, res) => res.status(201).json(await createBooking(req.user, bookingInput.parse(req.body), { forAdmin: true })))

// PATCH /admin/bookings/:id  (edit any field + status)
r.patch('/bookings/:id', async (req, res) => {
  const patch = adminBookingPatch.parse(req.body)
  const out = await updateBooking(req.user, req.params.id, patch, { admin: true })
  res.json(out)
})

// POST /admin/bookings/:id/cancel
r.post('/bookings/:id/cancel', async (req, res) => res.json(await cancelBooking(req.user, req.params.id, cancelInput.parse(req.body).reason, { admin: true })))

// DELETE /admin/bookings/:id  (hard delete, payments cascade)
r.delete('/bookings/:id', async (req, res) => {
  const row = await loadBooking(req.user, req.params.id, true)
  // Confirmed / completed bookings and anything with money received are business records: they are kept forever.
  if (['confirmed', 'completed'].includes(row.status) || row.paid_amount > 0)
    throw httpError(409, 'Confirmed, completed or paid bookings are kept for the records and cannot be deleted')
  const { error } = await supabase.from('bookings').delete().eq('id', row.id)
  if (error) throw error
  res.json({ ok: true })
})

// POST /admin/bookings/:id/payments  (cash at the office, or a transfer staff saw arrive — recorded as already verified)
r.post('/bookings/:id/payments', async (req, res) => {
  const row = await loadBooking(req.user, req.params.id, true)
  if (['cancelled', 'expired'].includes(row.status)) throw httpError(409, 'A cancelled booking cannot take payments. Re-open the booking first.')
  const p = adminPaymentInput.parse(req.body)
  if (p.reference) p.reference = p.reference.toUpperCase()
  const rows = await paymentRows(row.id)
  assertRoom(row, rows, p.amount)
  // same payment twice within seconds = a double click, not a second payment
  const dup = rows.some((x) => x.method === p.method && x.amount === p.amount && x.status !== 'rejected' && Date.now() - new Date(x.created_at).getTime() < 15_000)
  if (dup) throw httpError(409, 'The same payment was just recorded. Refresh to check before adding it again.')
  await assertFreshReference(p.method, p.reference)
  const { data, error } = await supabase.from('payments').insert({
    booking_id: row.id, ...p, status: 'verified', submitted_by: req.user.id, verified_by: req.user.id, verified_at: new Date().toISOString(),
  }).select().single()
  if (error) mapPaymentDbError(error)
  const booking = await recomputePaid(row.id, req.user.id)
  await logEvent(row.id, req.user.id, 'admin_payment_recorded', { amount: p.amount, method: p.method, paymentId: data.id })
  res.status(201).json({ payment: toApiPayment(data), booking: toApi(booking) })
})

// PATCH /admin/payments/:id  { status: 'verified' | 'rejected' }
r.patch('/payments/:id', async (req, res) => {
  const { status } = paymentReview.parse(req.body)
  const { data: pay } = await supabase.from('payments').select('*').eq('id', req.params.id).maybeSingle()
  if (!pay) throw httpError(404, 'Payment not found')
  const { data: bk } = await supabase.from('bookings').select('id,total,advance,status').eq('id', pay.booking_id).single()
  // A verified payment is money in the till: it is final. (Wrongly verified? Record a refund / correction with the customer, do not silently un-verify.)
  if (pay.status === 'verified' && status !== 'verified') throw httpError(409, 'A verified payment cannot be changed')
  if (status === 'verified' && pay.status !== 'verified') {
    // A cancelled booking can never be confirmed by a late verification. Reject the payment and refund the customer instead.
    if (['cancelled', 'expired'].includes(bk.status)) throw httpError(409, 'This booking is cancelled, so the payment cannot be verified. Reject it and refund the customer.')
    // verifying must never push the booking past its total (a cash payment may have been recorded meanwhile)
    assertRoom(bk, await paymentRows(pay.booking_id), pay.amount, pay.id)
  }
  if (pay.status === status) return res.json({ payment: toApiPayment(pay), booking: toApi((await supabase.from('bookings').select('*').eq('id', pay.booking_id).single()).data) })
  const { data, error } = await supabase.from('payments').update({
    status, verified_by: req.user.id, verified_at: new Date().toISOString(),
  }).eq('id', pay.id).select().single()
  if (error) mapPaymentDbError(error)
  let booking = await recomputePaid(pay.booking_id, req.user.id)
  await logEvent(pay.booking_id, req.user.id, `payment_${status}`, { paymentId: pay.id, amount: pay.amount })
  if (status === 'rejected' && booking.status === 'pending' && booking.paid_amount < booking.advance) {
    // The hold was paused while this payment was in review. Give the customer a fresh 24 h to pay again,
    // otherwise the next sweep would cancel the booking at once.
    const { count } = await supabase.from('payments').select('id', { count: 'exact', head: true }).eq('booking_id', booking.id).eq('status', 'pending')
    const floor = Date.now() + 24 * 3600_000
    if (!count && (!booking.hold_expires_at || new Date(booking.hold_expires_at).getTime() < floor)) {
      const { data: fresh, error: eh } = await supabase.from('bookings').update({ hold_expires_at: new Date(floor).toISOString() }).eq('id', booking.id).select().single()
      if (eh) throw eh
      booking = fresh
      await logEvent(booking.id, req.user.id, 'hold_extended_after_reject', { hours: 24 })
    }
  }
  res.json({ payment: toApiPayment(data), booking: toApi(booking) })
})

// GET /admin/stats
r.get('/stats', async (_req, res) => {
  await sweepHolds()
  await sweepCompleted()
  const { data, error } = await supabase.from('bookings').select('status,total,paid_amount,booking_date')
  if (error) throw error
  const { data: waiting, error: ew } = await supabase.from('payments').select('booking_id').eq('status', 'pending')
  if (ew) throw ew
  const today = dhakaToday(), horizon = addDays(today, 30)
  const s = { total: data.length, pending: 0, confirmed: 0, cancelled: 0, expired: 0, completed: 0, revenue: 0, collected: 0, upcoming: 0, toVerify: new Set(waiting.map((x) => x.booking_id)).size }
  for (const b of data) {
    s[b.status] += 1
    if (b.status === 'confirmed' || b.status === 'completed') s.revenue += b.total
    s.collected += b.paid_amount
    if (['pending', 'confirmed'].includes(b.status) && b.booking_date >= today && b.booking_date <= horizon) s.upcoming += 1
  }
  res.json(s)
})
export default r
