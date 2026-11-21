import { z } from 'zod'
import { isRealDate } from './lib/dates.js'

const phone = z.string().transform((s) => s.replace(/[\s-]/g, ''))
  .refine((p) => /^(?:\+?88)?01[3-9]\d{8}$/.test(p), 'Invalid Bangladeshi mobile number')
const isoDate = z.string().refine(isRealDate, 'Invalid date, use YYYY-MM-DD')

// Plain fields (no defaults) so the same shape serves create and partial update.
const fields = {
  eventType: z.enum(['Wedding', 'Reception', 'Holud', 'Corporate', 'Birthday', 'Milad', 'Other']),
  packageId: z.string(),
  date: isoDate,
  shift: z.enum(['morning', 'evening', 'full']),
  guests: z.coerce.number().int().min(20).max(2000),
  addons: z.array(z.string()).max(10),
  catering: z.enum(['own', 'hall']),
  menu: z.string().nullish(),
  name: z.string().trim().min(2).max(80),
  phone,
  email: z.string().trim().email().or(z.literal('')).nullish(),
  notes: z.string().max(500).nullish(),
}

export const bookingInput = z.object({
  ...fields,
  addons: fields.addons.default([]),
  catering: fields.catering.default('own'),
})
export const bookingPatch = z.object(fields).partial().strict()
export const adminBookingPatch = z.object({
  ...fields,
  status: z.enum(['pending', 'confirmed', 'cancelled', 'expired', 'completed']),
}).partial().strict()

export const dateRange = z.object({ from: isoDate, to: isoDate })
export const paymentInput = z.object({
  amount: z.coerce.number().int().positive().max(100_000_000),
  method: z.enum(['bkash', 'nagad', 'bank', 'office', 'card']),
  reference: z.string().trim().max(60).optional(),   // any text is accepted; staff verify it against the real statement
})
export const adminPaymentInput = paymentInput.extend({ note: z.string().trim().max(200).optional() })
export const paymentReview = z.object({ status: z.enum(['verified', 'rejected']) })
export const cancelInput = z.object({ reason: z.string().trim().max(200).optional() }).default({})

export const adminList = z.object({
  status: z.enum(['pending', 'confirmed', 'cancelled', 'expired', 'completed']).optional(),
  q: z.string().trim().max(60).optional(),
  verify: z.enum(['1', 'true']).optional(),   // only bookings that have a payment waiting for admin verification
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export const meInput = z.object({
  fullName: z.string().trim().min(2).max(80).optional(),
  phone: phone.optional(),
}).strict()
