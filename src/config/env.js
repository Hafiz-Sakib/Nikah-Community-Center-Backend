import 'dotenv/config'
import { z } from 'zod'

export const env = z.object({
  PORT: z.coerce.number().default(4000),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CLIENT_ORIGINS: z.string().default('http://localhost:5173'),
  HOLD_HOURS: z.coerce.number().default(72),   // unpaid pending booking is auto-cancelled after this many hours (3 days)
  EDIT_CUTOFF_DAYS: z.coerce.number().default(3),
  MAX_PENDING_PER_USER: z.coerce.number().default(3),
}).parse(process.env)
