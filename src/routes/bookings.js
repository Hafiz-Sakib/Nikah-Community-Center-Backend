import { Router } from 'express'
import { supabase } from '../lib/supabase.js'
import { bookingInput, bookingPatch, paymentInput, cancelInput } from '../schemas.js'
import { createBooking, updateBooking, cancelBooking, loadBooking, logEvent } from '../services/bookingService.js'
import { toApi } from '../lib/mappers.js'
import { httpError } from '../middleware/error.js'

const r = Router()

const withPayments = async (row) => {
  const { data, error } = await supabase.from('payments').select('*').eq('booking_id', row.id).order('created_at')
  if (error) throw error
  return toApi(row, data ?? [])
}
const own = (req) => loadBooking(req.user, req.params.id)

r.post('/', async (req, res) => res.status(201).json(await createBooking(req.user, bookingInput.parse(req.body))))

r.get('/', async (req, res) => {
  const { data, error } = await supabase.from('bookings').select('*, payments(*)')
    .eq('user_id', req.user.id).order('booking_date', { ascending: false })
  if (error) throw error
  res.json(data.map(({ payments, ...row }) => toApi(row, payments)))
})

r.get('/:id', async (req, res) => res.json(await withPayments(await own(req))))
r.patch('/:id', async (req, res) => res.json(await updateBooking(req.user, req.params.id, bookingPatch.parse(req.body))))
r.post('/:id/cancel', async (req, res) => res.json(await cancelBooking(req.user, req.params.id, cancelInput.parse(req.body).reason)))

r.get('/:id/invoice', async (req, res) => {
  const b = await withPayments(await own(req))
  const paid = b.payments.filter((p) => p.status === 'verified').reduce((s, p) => s + p.amount, 0)
  res.json({ ...b, invoiceNo: 'INV-' + b.id.replace(/^NCC-/, ''), paidAmount: paid, balance: b.total - paid })
})

r.post('/:id/payments', async (req, res) => {
  const row = await own(req)
  if (!['pending', 'confirmed'].includes(row.status)) throw httpError(409, 'This booking is not active')
  const p = paymentInput.parse(req.body)
  if (p.amount > row.total - row.paid_amount) throw httpError(400, 'Amount is more than the balance due')
  const { data, error } = await supabase.from('payments')
    .insert({ booking_id: row.id, ...p, status: 'pending', submitted_by: req.user.id }).select().single()
  if (error) throw error
  await logEvent(row.id, req.user.id, 'payment_submitted', { amount: p.amount, method: p.method })
  res.status(201).json({ id: data.id, amount: data.amount, method: data.method, reference: data.reference ?? '', status: data.status, createdAt: data.created_at })
})
export default r
