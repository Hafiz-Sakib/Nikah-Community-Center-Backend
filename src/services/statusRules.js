import { httpError } from '../middleware/error.js'

/* ONE place that decides which status changes are allowed, so the admin screen, the edit form and the API can never disagree.

   The money rule:
     A booking becomes CONFIRMED only when staff-VERIFIED payments cover its advance (verified >= advance).
     A payment the customer merely submitted ("in review") counts for nothing here.
     Nobody (admin included) can force a booking to Confirmed by hand: verifying the payment does it automatically.

   The cancel rule:
     Cancelled / Expired is final. It can never go back to Confirmed (or Pending). If the customer still wants the date,
     they make a new booking, which re-checks that the slot is free. This also protects against a freed slot being
     handed to someone else and then silently taken back. */
export const CLOSED = ['cancelled', 'expired']

/** Pure. `verified` = sum of verified payments, `advance` = the booking's advance. Returns nothing or throws a 409. */
export function assertStatusChange(from, to, { verified = 0, advance = 0 } = {}) {
  if (!to || to === from) return
  if (CLOSED.includes(from)) throw httpError(409, `A ${from === 'expired' ? 'cancelled' : from} booking cannot be confirmed or re-opened. Please create a new booking for this date.`)
  if (from === 'completed') throw httpError(409, 'A completed booking cannot change status')
  if (to === 'expired') throw httpError(409, 'Unpaid bookings expire automatically. Use Cancel instead.')
  if (to === 'confirmed') {
    if (verified < advance) throw httpError(409, 'Verify the advance payment first. A booking is confirmed automatically once the payment is verified.')
    return
  }
  if (to === 'completed') {
    if (from !== 'confirmed') throw httpError(409, 'Only a confirmed booking can be completed')
    return
  }
  if (to === 'cancelled') return   // pending / confirmed -> cancelled is always fine
  if (to === 'pending') throw httpError(409, 'A booking returns to pending by itself when its date or shift changes before the advance is verified')
}

/** Pure. Should a PENDING booking be confirmed right now? Only verified money counts. */
export const shouldAutoConfirm = ({ status, advance }, verified) => status === 'pending' && verified >= advance
