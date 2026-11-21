import { z, ZodError } from 'zod'

export const httpError = (status, message) => Object.assign(new Error(message), { status })

export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Invalid input', details: z.flattenError(err) })
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' })
  const status = err.status ?? 500
  if (status === 500) console.error(err)   // never send raw DB errors to the client
  res.status(status).json({ error: status === 500 ? 'Something went wrong' : err.message })
}
