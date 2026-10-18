# M&M Laundromat — website & booking app

Single-page marketing + booking site (vanilla HTML/CSS/JS) served by a small Express server.

## Run locally

Requires Node.js 20.11+.

    npm install
    npm run dev            # http://localhost:3000 (development mode)

## Run in production

    cp .env.example .env   # or set the variables in your host's dashboard
    npm ci --omit=dev
    npm start              # sets NODE_ENV=production

The server refuses to start in production unless `SITE_URL` (public https origin) and
`ADMIN_TOKEN` (random, >= 32 chars) are set. `__SITE_URL__` placeholders in
`index.html`, `robots.txt` and `sitemap.xml` are filled in from `SITE_URL` at startup.

- Health check: `GET /healthz`
- Admin (send `X-Admin-Token: <ADMIN_TOKEN>`): `GET /api/admin/submissions`,
  `GET /api/admin/stats`, `POST /api/orders/:id/advance`

## Data

Data is kept in `DATA_FILE` (default `./data/data_store.json`, written atomically,
mode 0600). This is only suitable for a single-instance pilot on a persistent disk.
Move to a managed database before launch and back the file up until then.
