import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

process.env.SUPABASE_URL = 'http://127.0.0.1:9'          // unreachable on purpose
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'.repeat(40)
process.env.CLIENT_ORIGINS = 'http://localhost:5173'

let server, base
before(async () => {
  const { default: app } = await import('../src/app.js')
  server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())
const j = (p, o) => fetch(base + p, o).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))

test('logged-out cannot book / list / use admin', async () => {
  assert.equal((await j('/api/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401)
  assert.equal((await j('/api/bookings')).status, 401)
  assert.equal((await j('/api/me')).status, 401)
  assert.equal((await j('/api/admin/stats')).status, 401)
  assert.equal((await j('/api/bookings', { headers: { authorization: 'Bearer junk' } })).status, 401)
})
test('availability validates input', async () => {
  assert.equal((await j('/api/availability')).status, 400)
  assert.equal((await j('/api/availability?from=2027-01-01&to=2028-12-31')).status, 400)
  assert.equal((await j('/api/availability?from=2027-02-31&to=2027-03-01')).status, 400)
  assert.equal((await j('/api/availability?from=2027-03-01&to=2027-02-01')).status, 400)
})
test('unknown route 404', async () => assert.equal((await j('/api/nope')).status, 404))
test('bad JSON 400', async () => assert.equal((await j('/api/health', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400))
