# Grabster — handoff for deploy (2026-10-09)

Monorepo: `grabster-api` (Express + Postgres), `grabster-app` (Vue 3 site, nginx image), `grabster-local`
(single-file HTML, published as `grabster-app/public/grabster.html`), `grabster-mcp`, `packages/solana-core`.
Node `24.19.0` (`.nvmrc`). Deploy is Docker Compose: `make deploy`, or `make deploy-api` / `make deploy-app`.

## Not in this archive — set on the server
`.env` is **not included** (it holds the treasury secret and API keys). Create it from `.env.example`:

- `TREASURY_SECRET`, `TREASURY_ADDRESS` — treasury keypair (from the owner, over a secure channel).
- `SOLANA_RPC_URL` — a private mainnet RPC (the public one in the example is rate-limited).
- `JUPITER_API_KEY`, `VITE_REOWN_PROJECT_ID`, `DEMO_ADDRESS`.
- `DB_*` — Postgres; tables are created by the API on start (`grabster-api/src/shared/db.ts`).
- `SECRET_ACCESS_SIGN_KEY`, `SECRET_REFRESH_SIGN_KEY` — long random strings.
- Domain: `VITE_SITE_URL`, `VITE_API_URL`, `ALLOWED_ORIGINS`, `COOKIE_SECURE=1` — see `docs/release-domain.md`.
  `VITE_API_URL` must be set for the release build (the docs pages show it in every example).
- `FEATURE_SWP` — background job that sells/burns treasury tokens. Enable only on the production server, on purpose.

`VITE_*`, `FEE_DIRECT` and `TREASURY_ADDRESS` are baked in at build time: after changing them run `make deploy-app`
(rebuilds the site and the local HTML file).

## What changed in this release
- Security (API): strict checks on every signed transaction before Grabster co-signs or credits a balance
  (`packages/solana-core/src/inspect.ts`, submit/balance/ledger modules). Self-test: `npm run check:inspect -w grabster-api`.
  **Deploy the API together with the site.**
- Ledger: partial plans credited per landed transaction; referral share computed from the service fee only;
  `grabbed_at` is set only after a referral credit settles available.
- CSRF: with `ALLOWED_ORIGINS` set, cookie sessions ignore junk `Authorization` headers (no cookie fallback).
- Site redesign: dark theme by default (light switch in the header), home page with a live wallet check and demo,
  Cleanup in two columns, profile/API/MCP/local pages, header shows the Grabster balance, X link in the footer.
- Result page `/check/:address`: one main button by signer state — Connect wallet to reclaim / Switch wallet to reclaim /
  Reclaim SOL — with a standing note when the connected wallet is not the owner.
- Referrals are hidden in the UI only (`grabster-app/src/lib/features.ts`, `SHOW_REFERRALS`); server logic and `/r/:code` work.

## Before going live
- Real signing was not tested end to end in this round: do one small reclaim on mainnet with a test wallet
  (single wallet, and Grabster balance as recipient) after deploy.
- Replace before launch: demo wallets in `grabster-app/src/lib/home-demo.ts` (owner's addresses) and the client logos in
  `grabster-app/public/clients/` (official brand files).
- Fees stay 1% direct / 0.5% to Grabster balance (`FEE_DIRECT`, `FEE_BALANCE`).

## Checks run on this archive's code
`npx vue-tsc --noEmit -p tsconfig.app.json` (grabster-app) — pass; production build — pass;
`npm run check:inspect -w grabster-api` — all PASS; `npm run check:local-plan` — ok.
