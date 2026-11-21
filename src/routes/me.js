import { Router } from 'express'
import { supabase } from '../lib/supabase.js'
import { meInput } from '../schemas.js'

const r = Router()
const out = (p) => ({ id: p.id, email: p.email, fullName: p.full_name, avatarUrl: p.avatar_url, phone: p.phone, role: p.role })

r.get('/', (req, res) => res.json(out(req.user.profile)))

r.patch('/', async (req, res) => {
  const b = meInput.parse(req.body)
  const update = {}
  if (b.fullName !== undefined) update.full_name = b.fullName
  if (b.phone !== undefined) update.phone = b.phone
  if (!Object.keys(update).length) return res.json(out(req.user.profile))
  const { data, error } = await supabase.from('profiles').update(update).eq('id', req.user.id)
    .select('id,email,full_name,avatar_url,phone,role').single()
  if (error) throw error
  res.json(out(data))
})
export default r
