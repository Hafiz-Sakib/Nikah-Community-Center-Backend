import { env } from '../config/env.js'

export const toApiPayment = (p) => ({
  id: p.id, amount: p.amount, method: p.method, reference: p.reference ?? '', status: p.status,
  note: p.note ?? '', createdAt: p.created_at, verifiedAt: p.verified_at ?? null,
})

// DB row (+ optional payments) -> same shape the old localStorage booking had
export const toApi = (r, payments) => ({
  id: r.code, createdAt: r.created_at, status: r.status, eventType: r.event_type,
  packageId: r.package_id, shift: r.shift, date: r.booking_date, guests: r.guests,
  addons: r.addons, catering: r.catering, menu: r.menu_id,
  name: r.contact_name, phone: r.contact_phone, email: r.contact_email ?? '', notes: r.notes ?? '',
  total: r.total, advance: r.advance, paidAmount: r.paid_amount, holdExpiresAt: r.hold_expires_at, cancelReason: r.cancel_reason ?? null, holdHours: env.HOLD_HOURS,
  priceSnapshot: r.price_snapshot,
  ...(payments ? { payments: payments.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)).map(toApiPayment) } : {}),
})
