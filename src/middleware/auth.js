import { supabase } from '../lib/supabase.js'
import { httpError } from './error.js'

export async function requireAuth(req, _res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) throw httpError(401, 'Please log in')

  // Supabase validates signature + expiry. One network call per request: fine for a hobby app.
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) console.warn("[auth] getUser failed:", error?.message)
  if (error || !data?.user) throw httpError(401, 'Session expired, please log in again')

  const { data: profile, error: pErr } = await supabase.from('profiles')
    .select('id,email,full_name,avatar_url,phone,role').eq('id', data.user.id).maybeSingle()
  if (!profile) console.warn("[auth] profile lookup failed:", pErr?.message, data.user.id)
  if (!profile) throw httpError(401, 'Account not ready, please log in again')

  // Keep the profile photo in step with the Google account: the DB trigger only copies it at sign-up,
  // so older users (or users who later changed their Google photo) would otherwise show initials in the admin panel.
  const meta = data.user.user_metadata ?? {}
  const photo = meta.avatar_url || meta.picture || null
  if (photo && photo !== profile.avatar_url) {
    profile.avatar_url = photo
    supabase.from('profiles').update({ avatar_url: photo }).eq('id', data.user.id).then(() => {}, () => {})
  }

  req.user = { id: data.user.id, email: data.user.email, role: profile.role ?? 'user', profile }
  next()
}

export const requireAdmin = (req, _res, next) => {
  if (req.user?.role !== 'admin') throw httpError(403, 'Admins only')
  next()
}
