# Moving Grabster to the new domain

Placeholders: `NEW_DOMAIN` (site) and `API_BASE` (API + MCP). Both are still open questions for the owner.
Old hosts: `grabster.overdone.it` (site), `grabster-api.overdone.it` (API, MCP).

## 1. Environment (`.env`, see `.env.example`)

| Variable | Value | Why |
|---|---|---|
| `VITE_SITE_URL` | `https://NEW_DOMAIN` | canonical, `og:url`, `og:image`, `sitemap.xml`, `robots.txt` (filled at build time by `grabster-app/vite.config.ts`) |
| `VITE_API_URL` | `https://API_BASE` | API/MCP origin shown in the docs pages and used by the app (baked into the image) |
| `ALLOWED_ORIGINS` | `https://NEW_DOMAIN,https://grabster.overdone.it` | only these site origins can read signed-in responses, and cookie-authenticated POSTs from any other origin get 403; `Authorization: Bearer …` (partner key or access token) is allowed cross-origin, but a junk Authorization header never falls back to the session cookie. Empty = legacy any-origin mode (the API logs a warning when `COOKIE_SECURE=1`) |
| `COOKIE_SECURE` | `1` | site and API on different hosts over HTTPS need `SameSite=None; Secure` cookies |

`VITE_*`, `FEE_DIRECT` and `TREASURY_ADDRESS` are baked into the app image and into `grabster.html`.
After changing them: `make deploy-app` (rebuilds the app and the local file).

Sign-in (SIWS) is not bound to a domain: the signed message carries the address and a nonce only, so it keeps working on the new host.

## 2. HTTPS and nginx

The app container listens on `127.0.0.1:${APP_PORT}`. Put the TLS front proxy for `NEW_DOMAIN` in front of it as for the current host.
SPA routes (`/cleanup`, `/profile/...`, `/check/:address`) already fall back to `index.html` (`grabster-app/nginx.conf`), so direct opening and refresh work.

Old site → new site, permanent, keeping path and query (referral links `/r/CODE` and `?ref=` included):

```nginx
server {
  listen 443 ssl;
  server_name grabster.overdone.it;
  # ssl_certificate ... (existing)
  return 301 https://NEW_DOMAIN$request_uri;
}
```

The app itself maps old paths: `/bulk` → `/cleanup?mode=list`, `/balance` → `/profile/balance`, `/referrals` → `/profile/referrals`, `/developers` → `/api` (query and hash kept).

## 3. API and MCP

Do **not** rely on a web redirect for the API: `POST` clients and MCP clients often don't follow 301/302, and a redirect drops the
`Authorization` header in many HTTP libraries. If `API_BASE` changes, serve **both** hostnames from the same backend (two `server_name`s
on one proxy) for at least one release cycle, then retire the old one after partners have moved. Partner keys and MCP configs keep working
on either host because keys live in the database, not in the hostname.

Previously downloaded `grabster.html` files talk only to the RPC URL in their field — not to the Grabster site or API — so they keep
working after the move. They do carry the fee percent and treasury address from their build.

## 4. After switching — check

- [ ] `https://NEW_DOMAIN/` loads; `view-source` shows canonical/og tags with the new origin; `/robots.txt` and `/sitemap.xml` exist
- [ ] Direct open + refresh: `/cleanup?mode=list`, `/profile/balance`, `/check/<address>`, `/api`, `/mcp`, `/local`
- [ ] `https://grabster.overdone.it/bulk?ref=x` → `https://NEW_DOMAIN/cleanup?ref=x&mode=list`
- [ ] `https://grabster.overdone.it/r/CODE` → new domain, referral remembered (server-side; Profile → Referrals only if `SHOW_REFERRALS` is on)
- [ ] Single-wallet scan (demo), wallet-list scan, sign-in with a wallet, Profile → Balance loads (Referrals only if `SHOW_REFERRALS` is on)
- [ ] Profile → API key, then `curl -H "Authorization: Bearer KEY" https://API_BASE/v1/partner/me`
- [ ] MCP: config from `/mcp`, "Check key" button, `scan_address` from a client
- [ ] `/local` → Download HTML, open it, scan the demo address
- [ ] Financial operations only in the project's own test scenario (small wallet you control)
