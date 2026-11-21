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
