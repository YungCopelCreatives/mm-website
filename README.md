# M&M Laundry — website

Marketing site and customer web app (vanilla HTML/CSS/ES modules) served by a small Express
server. The website uses **the same accounts, database and APIs as the M&M mobile app**:

| Concern | Backend |
| --- | --- |
| Sign up / log in / Google sign-in / password reset / email verification | Firebase Auth (browser SDK) |
| Profile, saved addresses, orders, tracking, handover PIN, driver card, partner list | Supabase Postgres under RLS, with the Firebase ID token as a third-party JWT |
| Prices | `GET {SUPABASE_URL}/functions/v1/get-pricing` |
| Creating an order and paying | `POST {SUPABASE_URL}/functions/v1/create-order` (`payment_method: 'ozow'`) then redirect to Ozow |
| Contact, business, driver and laundromat-partner forms | `POST {SUPABASE_URL}/functions/v1/submit-form` (draft in `supabase-functions-to-add/`) |
| Bot / abuse protection | Firebase App Check (reCAPTCHA Enterprise), sent as `X-Firebase-AppCheck` |

The Express server stores **no user data**: it serves static files with security headers,
renders `/config.js` (public client config from env), redirects Ozow's return POST to the
order page and falls back to `index.html` for SPA routes.

## Run locally

Requires Node.js 20.11+.

    npm install
    cp .env.example .env          # fill in the public Firebase/Supabase values
    npm run dev                   # http://localhost:3000

Without Firebase/Supabase values the marketing pages work and sign-in/booking show a
"not available" message.

## Production

    npm ci --omit=dev
    npm start                     # NODE_ENV=production

In production the server refuses to start without `SITE_URL` and the Firebase/Supabase
public config, and if `SUPABASE_ANON_KEY` is a service-role key.

Backend setup the website needs:

- Add the website origin (e.g. `https://www.your-domain.co.za`) to the edge functions'
  `ALLOWED_ORIGINS` secret (CORS and Ozow `return_url`).
- Add the website domain to Firebase Auth > Authorized domains, and register it for the
  reCAPTCHA Enterprise key used by App Check.
- Deploy `submit-form` and apply its migration (see below).

## Code layout

- `index.html` — all pages (`<section data-route>`), header, drawer, footer, SEO.
- `styles.css` — design system (tokens in `:root`).
- `js/main.js` — router, link handling, header state; lazily loads `js/pages.js`.
- `js/nav.js` — accessible dropdown menus and mobile drawer.
- `js/backend.js` — Firebase + Supabase clients, App Check, `callFunction()`.
- `js/orders-api.js` — **the only place** that knows the create-order / get-pricing contract
  and the RLS queries.
- `js/booking.js`, `js/account.js`, `js/pages.js` — booking wizard, orders/tracking/account,
  auth and form pages.
- `vendor/` — self-hosted, pinned Firebase and supabase-js bundles. Rebuild with
  `npm run build:vendor` after changing the exact versions in `devDependencies`.

## Edge functions to add to the app repo

`supabase-functions-to-add/` holds code that belongs in the app repo's `supabase/` folder:

- `submit-form/index.ts` → `supabase/functions/submit-form/` (uses `../_shared/http.ts`;
  deploy with `--no-verify-jwt`).
- `migrations/20261019000000_website_forms.sql` → `supabase/migrations/`.
