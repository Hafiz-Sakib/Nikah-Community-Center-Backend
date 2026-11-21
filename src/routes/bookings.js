import { Router } from 'express'
import { supabase } from '../lib/supabase.js'
import { bookingInput, bookingPatch, paymentInput, cancelInput } from '../schemas.js'
import { createBooking, updateBooking, cancelBooking, loadBooking, logEvent } from '../services/bookingService.js'
import { sweepHolds, sweepCompleted } from '../services/sweep.js'
import { toApi } from '../lib/mappers.js'
import { httpError } from '../middleware/error.js'
import { standing, paymentRows, assertFreshReference, assertTrxReference, mapPaymentDbError, tk } from '../services/paymentService.js'

const r = Router()
const MAX_PENDING_PAYMENTS = 3

const withPayments = async (row) => {
  const { data, error } = await supabase.from('payments').select('*').eq('booking_id', row.id).order('created_at')
  if (error) throw error
  return toApi(row, data ?? [])
}
const own = (req) => loadBooking(req.user, req.params.id)

r.post('/', async (req, res) => res.status(201).json(await createBooking(req.user, bookingInput.parse(req.body))))

r.get('/', async (req, res) => {
  await sweepHolds()
  await sweepCompleted()
  const { data, error } = await supabase.from('bookings').select('*, payments(*)')
    .eq('user_id', req.user.id).order('booking_date', { ascending: false })
  if (error) throw error
  res.json(data.map(({ payments, ...row }) => toApi(row, payments)))
})

r.get('/:id', async (req, res) => {
  await sweepCompleted()   // a single booking page must show Completed as soon as its shift is over
  res.json(await withPayments(await own(req)))
})
r.patch('/:id', async (req, res) => res.json(await updateBooking(req.user, req.params.id, bookingPatch.parse(req.body))))
r.post('/:id/cancel', async (req, res) => res.json(await cancelBooking(req.user, req.params.id, cancelInput.parse(req.body).reason)))

r.get('/:id/invoice', async (req, res) => {
  const b = await withPayments(await own(req))
  const paid = b.payments.filter((p) => p.status === 'verified').reduce((s, p) => s + p.amount, 0)
  res.json({ ...b, invoiceNo: 'INV-' + b.id.replace(/^NCC-/, ''), paidAmount: paid, balance: b.total - paid })
})

r.post('/:id/payments', async (req, res) => {
  const row = await own(req)
  // a finished event can still owe money, so 'completed' may pay the balance; cancelled / expired may not
  if (!['pending', 'confirmed', 'completed'].includes(row.status)) throw httpError(409, 'This booking is not active')
  const p = paymentInput.parse(req.body)
  // Cash at the venue is recorded by staff only. If a customer could submit it, it would count as "paid" and pause the hold for nothing.
  if (p.method === 'office') throw httpError(400, 'Office payments are recorded by our staff when you pay at the venue')
  if (!p.reference) throw httpError(400, 'Enter the transaction ID')
  p.reference = p.reference.toUpperCase()
  assertTrxReference(p.reference)

  const rows = await paymentRows(row.id)
  const s = standing(row, rows)
  if (s.room <= 0) throw httpError(409, s.pending > 0 ? 'Your payments are waiting for verification and already cover the balance' : 'This booking is already paid in full')
  if (p.amount > s.room) throw httpError(400, `Amount is more than the balance due (${tk(s.room)})`)
  // while the advance is not covered, one payment must cover the rest of it, so a token amount cannot hold a date
  if (row.status === 'pending' && s.needAdvance > 0 && p.amount < s.needAdvance) throw httpError(400, `Pay at least ${tk(s.needAdvance)} to cover the advance`)
  // A submitted payment is treated as paid for now and pauses the 48 h hold until staff verify it, so the number of waiting payments is capped.
  if (rows.filter((x) => x.status === 'pending').length >= MAX_PENDING_PAYMENTS) throw httpError(429, 'You already have payments waiting for verification. Please wait for our team.')
  await assertFreshReference(p.method, p.reference)

  const { data, error } = await supabase.from('payments')
    .insert({ booking_id: row.id, ...p, status: 'pending', submitted_by: req.user.id }).select().single()
  if (error) mapPaymentDbError(error)
  await logEvent(row.id, req.user.id, 'payment_submitted', { amount: p.amount, method: p.method })
  res.status(201).json({ id: data.id, amount: data.amount, method: data.method, reference: data.reference ?? '', status: data.status, createdAt: data.created_at })
})
export default r
