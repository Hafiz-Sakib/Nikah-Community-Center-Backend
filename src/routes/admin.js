import { Router } from 'express'
import { supabase } from '../lib/supabase.js'
import { bookingInput, adminBookingPatch, paymentInput, paymentReview, adminList, cancelInput } from '../schemas.js'
import { createBooking, updateBooking, cancelBooking, loadBooking, recomputePaid, logEvent } from '../services/bookingService.js'
import { toApi, toApiPayment } from '../lib/mappers.js'
import { dhakaToday, addDays } from '../lib/dates.js'
import { httpError } from '../middleware/error.js'

const r = Router()

// GET /admin/bookings?status=&q=&from=&to=&page=&pageSize=
r.get('/bookings', async (req, res) => {
  const f = adminList.parse(req.query)
  await supabase.rpc('expire_stale_holds')   // release unpaid holds so the list never shows an expired hold as pending
  let q = supabase.from('bookings').select('*, payments(*), profiles(avatar_url)', { count: 'exact' })
  if (f.status) q = q.eq('status', f.status)
  if (f.from) q = q.gte('booking_date', f.from)
  if (f.to) q = q.lte('booking_date', f.to)
  if (f.q) {
    const t = f.q.replace(/[^\p{L}\p{N}+@._ -]/gu, '')       // keep it safe inside the or() filter
    if (t) q = q.or(`code.ilike.%${t}%,contact_name.ilike.%${t}%,contact_phone.ilike.%${t}%`)
  }
  const from = (f.page - 1) * f.pageSize
  const { data, count, error } = await q.order('booking_date', { ascending: false }).order('created_at', { ascending: false }).range(from, from + f.pageSize - 1)
  if (error) throw error
  res.json({ items: data.map(({ payments, profiles, ...row }) => ({ ...toApi(row, payments), avatar: (Array.isArray(profiles) ? profiles[0] : profiles)?.avatar_url ?? null })), total: count ?? 0, page: f.page, pageSize: f.pageSize })
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
  const { error } = await supabase.from('bookings').delete().eq('id', row.id)
  if (error) throw error
  res.json({ ok: true })
})

// POST /admin/bookings/:id/payments  (cash at office etc. — recorded as already verified)
r.post('/bookings/:id/payments', async (req, res) => {
  const row = await loadBooking(req.user, req.params.id, true)
  const p = paymentInput.parse(req.body)
  const { data, error } = await supabase.from('payments').insert({
    booking_id: row.id, ...p, status: 'verified', submitted_by: req.user.id, verified_by: req.user.id, verified_at: new Date().toISOString(),
  }).select().single()
  if (error) throw error
  const booking = await recomputePaid(row.id, req.user.id)
  res.status(201).json({ payment: toApiPayment(data), booking: toApi(booking) })
})

// PATCH /admin/payments/:id  { status: 'verified' | 'rejected' }
r.patch('/payments/:id', async (req, res) => {
  const { status } = paymentReview.parse(req.body)
  const { data: pay } = await supabase.from('payments').select('*').eq('id', req.params.id).maybeSingle()
  if (!pay) throw httpError(404, 'Payment not found')
  const { data, error } = await supabase.from('payments').update({
    status, verified_by: req.user.id, verified_at: new Date().toISOString(),
  }).eq('id', pay.id).select().single()
  if (error) throw error
  const booking = await recomputePaid(pay.booking_id, req.user.id)
  await logEvent(pay.booking_id, req.user.id, `payment_${status}`, { paymentId: pay.id, amount: pay.amount })
  res.json({ payment: toApiPayment(data), booking: toApi(booking) })
})

// GET /admin/stats
r.get('/stats', async (_req, res) => {
  const { data, error } = await supabase.from('bookings').select('status,total,paid_amount,booking_date')
  if (error) throw error
  const today = dhakaToday(), horizon = addDays(today, 30)
  const s = { total: data.length, pending: 0, confirmed: 0, cancelled: 0, expired: 0, completed: 0, revenue: 0, collected: 0, upcoming: 0 }
  for (const b of data) {
    s[b.status] += 1
    if (b.status === 'confirmed') s.revenue += b.total
    s.collected += b.paid_amount
    if (['pending', 'confirmed'].includes(b.status) && b.booking_date >= today && b.booking_date <= horizon) s.upcoming += 1
  }
  res.json(s)
})
export default r
