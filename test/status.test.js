import { test } from 'node:test'
import assert from 'node:assert/strict'
const { assertStatusChange, shouldAutoConfirm } = await import('../src/services/statusRules.js')

const adv = { advance: 102450 }
const code = (fn) => { try { fn(); return null } catch (e) { return e.status ?? e.statusCode } }

test('confirm needs VERIFIED money covering the advance', () => {
  assert.equal(code(() => assertStatusChange('pending', 'confirmed', { verified: 0, ...adv })), 409)
  assert.equal(code(() => assertStatusChange('pending', 'confirmed', { verified: 102449, ...adv })), 409)
  assert.equal(code(() => assertStatusChange('pending', 'confirmed', { verified: 102450, ...adv })), null)
})
test('cancelled and expired can never be confirmed or re-opened, even with the money in', () => {
  for (const from of ['cancelled', 'expired'])
    for (const to of ['confirmed', 'pending', 'completed'])
      assert.equal(code(() => assertStatusChange(from, to, { verified: 999999, ...adv })), 409, `${from} -> ${to}`)
})
test('completed is final; expired is system-only; manual pending is refused', () => {
  assert.equal(code(() => assertStatusChange('completed', 'confirmed', { verified: 999999, ...adv })), 409)
  assert.equal(code(() => assertStatusChange('completed', 'cancelled')), 409)
  assert.equal(code(() => assertStatusChange('pending', 'expired')), 409)
  assert.equal(code(() => assertStatusChange('confirmed', 'pending')), 409)
})
test('allowed moves: cancel an active booking, complete a confirmed one, same status is a no-op', () => {
  assert.equal(code(() => assertStatusChange('pending', 'cancelled')), null)
  assert.equal(code(() => assertStatusChange('confirmed', 'cancelled')), null)
  assert.equal(code(() => assertStatusChange('confirmed', 'completed')), null)
  assert.equal(code(() => assertStatusChange('pending', 'completed')), 409)
  assert.equal(code(() => assertStatusChange('cancelled', 'cancelled')), null)
  assert.equal(code(() => assertStatusChange('pending', 'pending')), null)
})
test('auto-confirm: only a pending booking, only verified money >= advance', () => {
  assert.equal(shouldAutoConfirm({ status: 'pending', advance: 100 }, 100), true)
  assert.equal(shouldAutoConfirm({ status: 'pending', advance: 100 }, 99), false)
  assert.equal(shouldAutoConfirm({ status: 'cancelled', advance: 100 }, 500), false)
  assert.equal(shouldAutoConfirm({ status: 'expired', advance: 100 }, 500), false)
  assert.equal(shouldAutoConfirm({ status: 'completed', advance: 100 }, 500), false)
})

const { cancelWindowClosed, deleteBlocker } = await import('../src/services/statusRules.js')
const { addDays } = await import('../src/lib/dates.js')
test('customer cancel window closes 3 days before the event', () => {
  const today = '2026-11-21'
  assert.equal(cancelWindowClosed('2026-11-22', today, addDays, 3), true)    // tomorrow
  assert.equal(cancelWindowClosed('2026-11-24', today, addDays, 3), true)    // exactly 3 days away: closed
  assert.equal(cancelWindowClosed('2026-11-25', today, addDays, 3), false)   // 4 days away: still open
  assert.equal(cancelWindowClosed('2026-12-10', today, addDays, 3), false)
})
test('delete: only cancelled bookings, and never with unsettled money', () => {
  assert.match(deleteBlocker({ status: 'pending' }), /Cancel it first/)
  assert.match(deleteBlocker({ status: 'confirmed', verified: 0 }), /Cancel it first/)
  assert.match(deleteBlocker({ status: 'completed' }), /Cancel it first/)
  assert.equal(deleteBlocker({ status: 'cancelled' }), null)
  assert.equal(deleteBlocker({ status: 'expired' }), null)
  assert.match(deleteBlocker({ status: 'cancelled', verified: 1000 }), /not marked as refunded/)
  assert.equal(deleteBlocker({ status: 'cancelled', verified: 1000, refunded: true }), null)
  assert.match(deleteBlocker({ status: 'cancelled', pending: 500, refunded: true }), /waiting for verification/)
})
