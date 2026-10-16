<<<<<<< HEAD
# BrightVale Finance — Digital Banking & Investment Platform

**Your Bright Path to Finance.**

A complete full-stack digital banking platform built with Node.js, Express, MongoDB, and vanilla JavaScript — checking & savings accounts, internal transfers, investment plans, loans, payment cards, KYC verification, live crypto market data, and a full admin console.

## Tech Stack

- **Backend:** Node.js, Express, MongoDB (Mongoose), JWT auth, bcrypt, multer uploads, node-cron, nodemailer
- **Frontend:** Static HTML/CSS/vanilla JS (no build step), Font Awesome, Chart.js
- **Integrations:** CoinGecko (live market prices), Brevo / Resend (transactional email)

## Features

### User
- Registration & login with email verification codes and password reset
- Checking + savings balances with instant internal transfers (idempotency-protected)
- Deposits (bank transfer instructions + BTC) with admin verification workflow
- Withdrawals to BTC or bank, with compliance gating
- Investment plans with fixed terms and hourly maturity processing
- Loan applications, approval workflow, and repayments
- Card products & applications
- 4-step KYC wizard (personal info → government ID → SSN → declaration)
- Live crypto prices and configured deposit wallets
- Referral program, notifications, support chat, transaction history

### Admin
- Dashboard with operational summaries
- User management with audited balance adjustments (mandatory reasons)
- Deposit / withdrawal / loan / KYC / card-application review
- Investment & loan plan management
- Per-user transaction visibility controls (hide/show) and demo history generator
- Crypto deposit wallet configuration
- Broadcast notifications & email, support replies, audit logs

## Security

- Rate limiting on all endpoints (stricter on auth), login lockout
- Server-authoritative ledger: atomic balance operations only via `utils/ledger.js`
- Idempotency keys on transfers and repayments; idempotent maturity cron
- Hashed password-reset & verification tokens; bcrypt password hashing
- Helmet security headers, restricted CORS, authenticated file access for KYC documents
- No card numbers, CVVs, PINs, or seed phrases are ever collected or stored

## Run Locally

Prerequisites: Node.js 18+ and a MongoDB instance (local or Atlas).

```bash
# Backend (port 5000)
cd backend
npm install
npm run dev        # or: npm start

# Frontend (port 3000) — serve the frontend/ folder with any static server
cd frontend
python -m http.server 3000     # or VS Code Live Server
```

Open http://localhost:3000

## Environment

Copy `backend/.env.example` to `backend/.env` and fill in:

- `MONGODB_URI` — MongoDB connection string
- `JWT_SECRET` — JWT signing secret (required in production)
- `CORS_ORIGIN` / `FRONTEND_URL` — frontend origins

Email is configured **via environment variables only** — no test fallback, no admin SMTP form:

```env
EMAIL_PROVIDER=brevo                 # brevo | resend
EMAIL_FROM_NAME=BrightVale Finance
EMAIL_FROM_EMAIL=noreply@yourdomain.com
# Brevo:
EMAIL_BREVO_LOGIN=your@email.com
EMAIL_BREVO_SMTP_KEY=xsmtpsib-...
# Resend:
EMAIL_RESEND_API_KEY=re_...
# Optional email OTP on every login:
LOGIN_OTP=false
```

Startup validates the configuration and fails in production when the selected provider is missing credentials. **Admin → Settings → Email Provider** shows live status and includes a working test-email tool (no secrets are ever exposed).

## Project Structure

```
backend/
  server.js          entry point: middleware, routes, maturity cron
  models/            Mongoose models (User, Transaction, Investment, ...)
  routes/            Express routers (auth, deposits, transfers, cards, crypto, ...)
  middleware/        JWT auth, admin guard, KYC guard, multer config
  utils/             ledger (atomic money ops), email, seed/backfill
frontend/
  index.html         public landing page
  login.html         auth (login / register / verify / reset)
  user/              authenticated user pages
  admin/             admin console
  assets/img/        brand & content imagery
  js/main.js         shared runtime (api wrapper, shell, theme)
  css/styles.css     design system (light + dark themes)
```

## Notes

- Balances are stored and moved only on the server; every movement writes a `Transaction` ledger entry.
- Card issuance, crypto trading, and bank-rail payouts are integration boundaries — wire a PCI-compliant issuer / exchange / banking provider to activate them.
- This repository is a development showcase.
=======
# bvf
>>>>>>> 6ef20ff690ce03f7f51149b51742d6e51a581e51
