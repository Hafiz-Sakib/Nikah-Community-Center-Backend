// "today" in Bangladesh, as YYYY-MM-DD
export const dhakaToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// true for a real calendar date like 2027-02-28 (rejects 2027-02-31)
export function isRealDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000)

// Minutes since midnight in Bangladesh right now
export const dhakaMinutesNow = () => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const get = (t) => Number(parts.find((x) => x.type === t)?.value ?? 0)
  return get('hour') * 60 + get('minute')
}

// When each shift ends (minutes after midnight, Dhaka time). Keep in sync with SHIFTS in config/pricing.js
export const SHIFT_END_MIN = { morning: 15 * 60, evening: 22 * 60 + 30, full: 22 * 60 + 30 }

/** true once the event's shift has finished (a booking for today is over after its shift ends, earlier dates are always over) */
export function eventHasEnded(bookingDate, shift, today = dhakaToday(), nowMin = dhakaMinutesNow()) {
  if (bookingDate < today) return true
  if (bookingDate > today) return false
  return nowMin >= (SHIFT_END_MIN[shift] ?? 22 * 60 + 30)
}
