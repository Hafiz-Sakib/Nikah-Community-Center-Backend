import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.SUPABASE_URL = 'http://127.0.0.1:9'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'.repeat(40)
const { buildQuote } = await import('../src/config/pricing.js')
const { bookingInput, bookingPatch } = await import('../src/schemas.js')

test('weekday morning, own catering', () => {
  const q = buildQuote({ packageId: 'wedding-plus', shift: 'morning', date: '2027-01-04', guests: 200 }) // Monday
  assert.equal(q.total, 85000); assert.equal(q.weekend, false); assert.equal(q.advance, 25500)
})
test('friday full day + hall catering + addon', () => {
  const q = buildQuote({ packageId: 'wedding-basic', shift: 'full', date: '2027-01-01', guests: 100, catering: 'hall', menu: 'wedding-plus', addons: ['stage', 'stage'] }) // Friday
  const base = Math.round(55000 * 1.7)
  assert.equal(q.base, base); assert.equal(q.weekendFee, Math.round(base * 0.15))
  assert.equal(q.total, base + Math.round(base * 0.15) + 65000 + 18000)
})
test('rejects bad input', () => {
  assert.throws(() => buildQuote({ packageId: 'x', shift: 'full', date: '2027-01-01', guests: 100 }))
  assert.throws(() => buildQuote({ packageId: 'wedding-basic', shift: 'full', date: '2027-01-01', guests: 1001 }))
  assert.throws(() => buildQuote({ packageId: 'wedding-basic', shift: 'full', date: '2027-01-01', guests: 100, addons: ['catering'] }))
})
test('schemas', () => {
  const ok = { eventType: 'Wedding', packageId: 'wedding-plus', date: '2027-01-04', shift: 'morning', guests: '200', name: 'Ali', phone: '017 1234-5678' }
  const p = bookingInput.parse(ok); assert.equal(p.phone, '01712345678'); assert.deepEqual(p.addons, []); assert.equal(p.catering, 'own')
  assert.throws(() => bookingInput.parse({ ...ok, phone: '123' }))
  assert.deepEqual(bookingPatch.parse({ guests: 50 }), { guests: 50 })           // no defaults leak into patch
  assert.throws(() => bookingPatch.parse({ status: 'confirmed' }))               // users cannot set status
  assert.throws(() => bookingPatch.parse({ total: 1 }))                          // nor price
})

test('package guest limits and event fit', async () => {
  const { packageFits, PACKAGES, HALL_CAP } = await import('../src/config/pricing.js')
  assert.equal(HALL_CAP, 2000)
  for (const p of Object.values(PACKAGES)) assert.ok(p.cap <= HALL_CAP)
  const base = { shift: 'morning', date: '2027-01-04' }
  assert.equal(buildQuote({ ...base, packageId: 'wedding-plus', guests: 2000 }).base, 85000)           // full hall
  assert.throws(() => buildQuote({ ...base, packageId: 'wedding-plus', guests: 2001 }), /20–2000/)
  assert.throws(() => buildQuote({ ...base, packageId: 'wedding-basic', guests: 1001 }), /20–1000/)
  assert.throws(() => buildQuote({ ...base, packageId: 'birthday-party', guests: 501 }), /20–500/)
  assert.doesNotThrow(() => buildQuote({ ...base, packageId: 'birthday-party', guests: 500 }))
  assert.equal(packageFits('birthday-party', 'Birthday'), true)
  assert.equal(packageFits('wedding-basic', 'Birthday'), false)   // birthdays have their own package
  assert.equal(packageFits('corporate', 'Milad'), false)
  assert.equal(packageFits('milad-mahfil', 'Milad'), true)
  assert.equal(packageFits('other-event', 'Other'), true)
  assert.equal(packageFits('nope', 'Other'), false)
  assert.throws(() => bookingInput.parse({ eventType: 'Wedding', packageId: 'wedding-plus', date: '2027-01-04', shift: 'morning', guests: 2001, name: 'Ali', phone: '01712345678' }))
})
