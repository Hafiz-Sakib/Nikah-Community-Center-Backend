import { Router } from 'express'
import { supabase } from '../lib/supabase.js'

const r = Router()
// Tiny DB query: also keeps the free Supabase project from pausing.
r.get('/', async (_req, res) => {
  await supabase.rpc('expire_stale_holds')   // also sweeps unpaid bookings, even on quiet days
  const { error } = await supabase.from('profiles').select('id', { head: true, count: 'exact' }).limit(1)
  if (error) return res.status(503).json({ ok: false })
  res.json({ ok: true, time: new Date().toISOString() })
})
export default r
