// Keep in sync with client src/data.js and src/lib/store.js quote().
import { httpError } from '../middleware/error.js'

export const SHIFTS = {
  morning: { label: 'Morning',  time: '10:00 AM – 3:00 PM',  mult: 1 },
  evening: { label: 'Evening',  time: '5:00 PM – 10:30 PM',  mult: 1 },
  full:    { label: 'Full Day', time: '10:00 AM – 10:30 PM', mult: 1.7 },
}
export const HALL_CAP = 2000      // the hall's absolute maximum, whatever the package
// cap = most guests this package allows (never above HALL_CAP). events = event types it may be booked for.
export const PACKAGES = {
  'wedding-basic': { name: 'Wedding Basic',   price: 55000,  cap: 1000, events: ['Wedding', 'Reception', 'Holud'] },
  'wedding-plus':  { name: 'Wedding Plus',    price: 85000,  cap: 2000, events: ['Wedding', 'Reception', 'Holud'] },
  'corporate':     { name: 'Corporate Event', price: 120000, cap: 1500, events: ['Corporate'] },
  'birthday-party':{ name: 'Birthday Party',  price: 35000,  cap: 500,  events: ['Birthday'] },
  'milad-mahfil':  { name: 'Milad Mahfil',    price: 40000,  cap: 1000, events: ['Milad'] },
  'other-event':   { name: 'Other Event',     price: 45000,  cap: 1000, events: ['Other'] },
}
/** A package is only for its own kinds of event (a birthday cannot be booked on the Corporate package). */
export const packageFits = (packageId, eventType) => !!PACKAGES[packageId]?.events.includes(eventType)
export const ADDONS = {            // per-event add-ons (catering is handled via FOOD)
  stage: { label: 'Stage & floral decoration', price: 18000 },
  sound: { label: 'Sound, lights & projector', price: 9000 },
  photo: { label: 'Photo & video coverage',    price: 22000 },
  bridal:{ label: 'Bridal / green room',       price: 5000 },
}
export const FOOD = {              // hall-catering menus, price per guest (any menu can go with any package)
  'wedding-basic': { name: 'Wedding Basic',   price: 450 },
  'wedding-plus':  { name: 'Wedding Plus',    price: 650 },
  'corporate':     { name: 'Corporate Event', price: 550 },
}
export const WEEKEND_RATE = 0.15   // Fri & Sat
export const ADVANCE_RATE = 0.3

export function buildQuote({ packageId, shift, date, guests, addons = [], catering = 'own', menu }) {
  const pkg = PACKAGES[packageId]; if (!pkg) throw httpError(400, 'Unknown package')
  const sh = SHIFTS[shift];        if (!sh)  throw httpError(400, 'Unknown shift')
  const max = Math.min(HALL_CAP, pkg.cap)
  if (guests < 20 || guests > max) throw httpError(400, `Guests must be 20–${max} for this package`)
  const food = catering === 'hall' ? FOOD[menu] : null
  if (catering === 'hall' && !food) throw httpError(400, 'Unknown food menu')

  const base = Math.round(pkg.price * sh.mult)
  const weekend = [5, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())   // Fri & Sat
  const weekendFee = weekend ? Math.round(base * WEEKEND_RATE) : 0

  const lines = []
  if (food) lines.push({ id: 'catering', label: `Hall catering · ${food.name} menu`, amount: food.price * guests, note: `${guests} guests × ${food.price}` })
  for (const id of new Set(addons)) {
    const a = ADDONS[id]; if (!a) throw httpError(400, `Unknown add-on: ${id}`)
    lines.push({ id, label: a.label, amount: a.price, note: '' })
  }
  const total = base + weekendFee + lines.reduce((s, l) => s + l.amount, 0)
  return {
    pkgName: pkg.name, shiftLabel: sh.label, shiftTime: sh.time, menuName: food?.name ?? null,
    base, weekend, weekendFee, lines, total, advance: Math.round(total * ADVANCE_RATE),
  }
}
