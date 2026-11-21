import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.SUPABASE_URL = 'http://127.0.0.1:9'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'.repeat(40)
const { standing, assertRoom, assertTrxReference, tk } = await import('../src/services/paymentService.js')
const { adminPaymentInput, paymentInput } = await import('../src/schemas.js')

const bk = { total: 238000, advance: 71400 }
const pay = (amount, status, id = String(Math.random())) => ({ id, amount, status })

test('no payments: whole total is open, advance uncovered', () => {
  const s = standing(bk, [])
  assert.deepEqual([s.verified, s.pending, s.room, s.balance, s.needAdvance, s.paidInFull], [0, 0, 238000, 238000, 71400, false])
})
test('advance verified, balance paid in steps', () => {
  let s = standing(bk, [pay(71400, 'verified')])
  assert.equal(s.balance, 166600); assert.equal(s.needAdvance, 0)
  s = standing(bk, [pay(71400, 'verified'), pay(100000, 'verified')])
  assert.equal(s.balance, 66600)
  s = standing(bk, [pay(71400, 'verified'), pay(100000, 'verified'), pay(66600, 'verified')])
  assert.equal(s.balance, 0); assert.equal(s.paidInFull, true); assert.equal(s.room, 0)
})
test('pending counts against room but not against balance; rejected counts for nothing', () => {
  const s = standing(bk, [pay(71400, 'verified'), pay(50000, 'pending'), pay(999, 'rejected')])
  assert.equal(s.room, 116600); assert.equal(s.balance, 166600)
})
test('pays everything at once', () => {
  const s = standing(bk, [pay(238000, 'verified')])
  assert.equal(s.paidInFull, true); assert.equal(s.needAdvance, 0)
})
test('assertRoom refuses an overpayment and a paid-in-full booking', () => {
  const rows = [pay(71400, 'verified')]
  assert.doesNotThrow(() => assertRoom(bk, rows, 166600))
  assert.throws(() => assertRoom(bk, rows, 166601), /Only ৳1,66,600 is left/)
  assert.throws(() => assertRoom(bk, [pay(238000, 'verified')], 1), /already paid in full/)
  assert.throws(() => assertRoom(bk, [pay(71400, 'verified'), pay(166600, 'pending')], 1), /waiting for verification/)
})
test('re-verifying a payment is judged without counting itself twice', () => {
  const p = pay(166600, 'pending', 'x')
  assert.doesNotThrow(() => assertRoom(bk, [pay(71400, 'verified'), p], 166600, 'x'))
})
test('amount must be a positive whole taka', () => {
  assert.throws(() => paymentInput.parse({ amount: 0, method: 'bkash' }))
  assert.throws(() => paymentInput.parse({ amount: -5, method: 'bkash' }))
  assert.throws(() => paymentInput.parse({ amount: 10.5, method: 'bkash' }))
  assert.equal(adminPaymentInput.parse({ amount: '500', method: 'office', note: ' cash ' }).note, 'cash')
  assert.equal(tk(238000), '৳2,38,000')
})

test('a TrxID cannot be the booking ID or too short', () => {
  assert.throws(() => assertTrxReference('NCC-KP43JT'), /Booking ID/)
  assert.throws(() => assertTrxReference('ncc-kp43jt'), /Booking ID/)
  assert.throws(() => assertTrxReference('AB-12'), /at least 6/)
  assert.doesNotThrow(() => assertTrxReference('9A7K2M4XQP'))
  assert.doesNotThrow(() => assertTrxReference('TXN-AB12CD34'))
})
