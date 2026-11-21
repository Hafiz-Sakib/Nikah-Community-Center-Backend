import { Router } from 'express'
import { supabase } from '../lib/supabase.js'
import { dateRange } from '../schemas.js'
import { daysBetween } from '../lib/dates.js'
import { httpError } from '../middleware/error.js'

const r = Router()
// Public: only booked days, no personal data.
r.get('/', async (req, res) => {
  const { from, to } = dateRange.parse(req.query)
  const span = daysBetween(from, to)
  if (span < 0) throw httpError(400, '"to" must be on or after "from"')
  if (span > 400) throw httpError(400, 'Range too large (max 400 days)')
  await supabase.rpc('expire_stale_holds')
  const { data, error } = await supabase.from('bookings').select('booking_date,shift')
    .in('status', ['pending', 'confirmed', 'completed']).gte('booking_date', from).lte('booking_date', to)
  if (error) throw error
  const days = {}
  for (const b of data) {
    const d = (days[b.booking_date] ??= { date: b.booking_date, morning: false, evening: false })
    if (b.shift === 'full') d.morning = d.evening = true
    else d[b.shift] = true
  }
  res.set('Cache-Control', 'public, max-age=20').json(Object.values(days))
})
export default r
