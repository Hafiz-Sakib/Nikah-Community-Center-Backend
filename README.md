# NCC Server (Express + Supabase)

API for Nikah Community Center. Auth = Supabase (Google + email/password). Express only verifies the JWT, reads `profiles.role`, and enforces rules. Packages/food/images stay hardcoded in the frontend; only **profiles, bookings, payments** live in the DB.

## Setup
1. **Supabase** (free): create project → note Project URL, anon key, service_role key.
   - Auth → Providers: enable Email and Google (redirect URI `https://<ref>.supabase.co/auth/v1/callback`).
   - Auth → URL Configuration: Site URL `https://nikah-convention.vercel.app`; Redirect URLs `http://localhost:5173/**`, `https://nikah-convention.vercel.app/**`.
   - SQL Editor → run `supabase/schema.sql`.
   - Sign up once in the app, then: `update public.profiles set role = 'admin' where email = 'YOUR_EMAIL';`
2. `cp .env.example .env`, fill `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (**server only, never in git/frontend**).
3. `npm install && npm run dev` → http://localhost:4000/api/health
4. `npm test` (no Supabase needed: validation, pricing, auth guards).

## Deploy (Render free)
Root directory = this repo, build `npm i`, start `node src/index.js`, add env vars, put Vercel URL in `CLIENT_ORIGINS`.
Free tier sleeps after ~15 min idle (first call 30–60 s). `.github/workflows/keepalive.yml` pings `/api/health` every 3 days (needed so Supabase does not pause) — add repo secret `API_URL`.

## Endpoints (`/api`)
Public: `GET /health`, `GET /availability?from&to`
User: `GET|PATCH /me`, `POST|GET /bookings`, `GET|PATCH /bookings/:id`, `POST /bookings/:id/cancel`, `GET /bookings/:id/invoice`, `POST /bookings/:id/payments`
Admin: `GET|POST /admin/bookings` (list rows include `avatar`, the booker's Google photo), `PATCH|DELETE /admin/bookings/:id`, `POST /admin/bookings/:id/cancel`, `POST /admin/bookings/:id/payments`, `PATCH /admin/payments/:id`, `GET /admin/stats`

Booking `:id` = public code (`NCC-AB12CD`).

## Key rules
- No double booking: Postgres exclusion constraint on `during` (error `23P01` → HTTP 409).
- Price always computed in `src/config/pricing.js` (**keep in sync with frontend `src/data.js` + `store.js`**), stored as `price_snapshot`; old invoices never change. Snapshot only recomputed when price inputs change.
- Pending booking holds slot `HOLD_HOURS` (24h); expires if unpaid and no payment awaiting review.
- Verified payments ≥ advance → booking auto-`confirmed`.
- User edit: pending/confirmed, ≥ `EDIT_CUTOFF_DAYS` before event. Confirmed + date/shift/package change → back to `pending`.
- Users never hard-delete (delete = cancel). Admin can.
