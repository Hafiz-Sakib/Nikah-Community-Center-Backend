import { supabase } from '../lib/supabase.js'
import { httpError } from '../middleware/error.js'

/* All money rules live here so the customer route, the admin route and the verify route can never disagree.
   Amounts are whole taka (integers). A payment counts against the booking unless it was rejected:
     verified = money staff have confirmed   pending = submitted by the customer, waiting for staff */
export const tk = (n) => '৳' + Number(n).toLocaleString('en-IN')

/** Pure: where a booking stands, given its total, advance and payment rows. */
export function standing({ total, advance }, rows, skipId = null) {
  const live = rows.filter((p) => p.id !== skipId)
  const sum = (st) => live.filter((p) => p.status === st).reduce((s, p) => s + p.amount, 0)
  const verified = sum('verified'), pending = sum('pending')
  return {
    verified, pending,
    room: Math.max(0, total - verified - pending),             // the most anyone may still add
    balance: Math.max(0, total - verified),                    // what is really unpaid (pending not counted)
    needAdvance: Math.max(0, advance - verified - pending),    // advance still uncovered
    paidInFull: verified >= total,
  }
}

export async function paymentRows(bookingId) {
  const { data, error } = await supabase.from('payments').select('id,amount,status,method,reference,created_at').eq('booking_id', bookingId)
  if (error) throw error
  return data ?? []
}

/** Throws unless `amount` still fits inside the booking total (rejected payments do not count). */
export function assertRoom(row, rows, amount, skipId = null) {
  const s = standing(row, rows, skipId)
  if (s.room <= 0) throw httpError(409, s.pending > 0 ? 'Payments waiting for verification already cover the balance' : 'This booking is already paid in full')
  if (amount > s.room) throw httpError(409, `Only ${tk(s.room)} is left to pay on this booking`)
  return s
}

/** A transaction ID can be claimed once: stops the same bKash / Nagad receipt being submitted twice. */
export async function assertFreshReference(method, reference, skipId = null) {
  if (!reference || method === 'office') return
  let q = supabase.from('payments').select('id').eq('method', method).eq('reference', reference).neq('status', 'rejected').limit(1)
  if (skipId) q = q.neq('id', skipId)
  const { data, error } = await q
  if (error) throw error
  if (data?.length) throw httpError(409, 'This transaction ID has already been submitted')
}

/** The database trigger (migration 004) is the last line of defence; show its refusal as a normal message. */
export const mapPaymentDbError = (error) => {
  if (error?.code === '23514') throw httpError(409, 'Payments would exceed the booking total')
  throw error
}
