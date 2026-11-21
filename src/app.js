import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import { env } from './config/env.js'
import { errorHandler } from './middleware/error.js'
import { requireAuth, requireAdmin } from './middleware/auth.js'
import health from './routes/health.js'
import availability from './routes/availability.js'
import me from './routes/me.js'
import bookings from './routes/bookings.js'
import admin from './routes/admin.js'

const app = express()
app.set('trust proxy', 1)                       // behind Render/Vercel proxy
app.use(helmet())
app.use(cors({ origin: env.CLIENT_ORIGINS.split(',').map((s) => s.trim()), credentials: false }))
app.use(express.json({ limit: '50kb' }))
app.use(morgan('tiny'))
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120 }))

app.use('/api/health', health)
app.use('/api/availability', availability)
app.use('/api/me', requireAuth, me)
app.use('/api/bookings', requireAuth, rateLimit({ windowMs: 60_000, limit: 30 }), bookings)
app.use('/api/admin', requireAuth, requireAdmin, admin)

app.use((_req, res) => res.status(404).json({ error: 'Not found' }))
app.use(errorHandler)
export default app
