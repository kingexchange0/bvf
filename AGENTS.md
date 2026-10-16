# AGENTS.md — BrightVale Finance

Guidance for AI coding agents working in this repository. All documentation, comments, and code identifiers are in English.

## Project Overview

BrightVale Finance is a full-stack digital banking and investment platform. Users register, deposit funds via Bitcoin (BTC), invest in ROI plans, request loans, submit KYC documents, earn referral bonuses, and chat with admin support. Admins get a dashboard for approving deposits/withdrawals/loans/KYC/card applications, managing investment and loan plans, crediting/debiting user balances (with mandatory reasons), configuring crypto deposit wallets, broadcasting notifications, and reviewing activity logs. The previous NFT/art marketplace, Tesla/SpaceX promotional pages, and wallet-connection (seed phrase) features were removed entirely.

The repository has two decoupled halves:

- `backend/` — Node.js + Express + MongoDB (Mongoose) REST API, JWT auth, scheduled investment-maturity cron job.
- `frontend/` — static HTML/CSS/vanilla-JavaScript pages (no build step, no framework, no bundler). Loaded via CDN: Font Awesome icons and Chart.js (dashboard charts only). Note: the README claims Tailwind CSS, but the code actually uses a hand-written stylesheet (`frontend/css/styles.css`); do not assume Tailwind utilities exist.

## Tech Stack

Backend dependencies (from `backend/package.json`):

- `express` ^4.18 — web framework
- `mongoose` ^8.0 — MongoDB ODM
- `jsonwebtoken` + `bcryptjs` — auth (JWT, 30-day expiry) and password hashing
- `multer` — file uploads (KYC documents, deposit proofs, profile pictures; 10 MB limit, JPEG/PNG/WebP/PDF only)
- `node-cron` — hourly investment maturity processing
- `nodemailer` — Brevo SMTP transport (email is env-only; no DB-stored SMTP, no test fallback)
- `axios`, `uuid`, `cors`, `dotenv`
- `nodemon` (dev dependency) for `npm run dev`

## Run and Build Commands

There is no build step. Prerequisite: Node.js v14+ and a running MongoDB (local or Atlas).

```bash
# Backend (from repo root)
cd backend
npm install
npm run dev    # development with nodemon auto-restart
npm start      # production (plain node server.js)
```

Server listens on `http://localhost:5000` (env `PORT`, default 5000).

The frontend must be served separately as static files, e.g.:

```bash
cd frontend
python -m http.server 3000     # or: http-server -p 3000, or VS Code Live Server
```

Frontend pages hit `http://localhost:5000/api` — this base URL is **hardcoded** at the top of `frontend/js/main.js` (`API_BASE_URL` / `SERVER_BASE_URL`). There is no environment/config indirection on the frontend.

### Environment variables (`backend/.env`)

- `PORT` — server port (default 5000)
- `MONGODB_URI` — MongoDB connection string (fallback in code: `mongodb://localhost:27017/crestcoin`)
- `JWT_SECRET` — JWT signing secret. **Code fallback is a hardcoded string** in `backend/middleware/auth.js`; always set this in `.env` outside local dev.

There is **no test suite** in this project — no test files, no test runner, no linting or formatting config. Verify changes by starting the server (`npm run dev`) and exercising the API/pages manually (e.g. with `curl`, as shown in the README's API examples). Do not add test scaffolding unless asked.

## Architecture and Code Organization

### Backend

- `backend/server.js` — single entry point: loads `.env`, wires global middleware (`helmet`, restricted `cors`, global rate limit, `express.json`), mounts all route modules under `/api/...`, schedules the hourly maturity cron (`0 * * * *`), and registers error + 404 handlers. Connects to MongoDB before listening; exits(1) on connection failure.
- `backend/utils/ledger.js` — the only sanctioned way to move money: `creditBalance` / `debitBalance` (atomic `findOneAndUpdate` with server-side balance check), `adjustBalance` (admin adjustments with mandatory reason + AdminLog), `hasCompletedTx` (idempotency guard), `runWithTransaction` (uses MongoDB transactions on replica sets, falls back to sequential writes on standalone).
- `backend/models/` — one Mongoose model per file (`User`, `Transaction`, `Deposit`, `Withdrawal`, `InvestmentPlan`, `Investment`, `LoanPlan`, `Loan`, `KYC`, `Message`, `Settings`, `AdminLog`, `Notification`), re-exported by `models/index.js`. Models are plain CommonJS `module.exports`.
- `backend/routes/` — one Express router per domain, mounted in `server.js`. Admin operations live inside the same domain routers under `/api/admin/...` paths or in `routes/admin.js`. Route files use Express 4 style (`router.get/post/put`).
- `backend/middleware/auth.js` — `auth` (JWT Bearer verification + `isActive` check), `adminOnly` (role guard), `generateToken`. Attach `auth` for private routes, `auth` + `adminOnly` for admin routes.
- `backend/middleware/upload.js` — preconfigured multer instance; routes it into `uploads/kyc`, `uploads/deposits`, or `uploads/profiles` based on the form field name. The `uploads/` directory is created at runtime, is not in the repo, and should not be committed. Files are served ONLY through the authenticated `routes/files.js` (`/api/files/...`), never via a public static route.
- `backend/utils/emailService.js` — `sendEmail`, `sendEmailToUser`, `sendBroadcastToAll` (batch size 50, 1 s delay between batches). SMTP credentials come from the `Settings` document, not from env vars.

### API conventions

- All responses use the envelope `{ success: boolean, message: string, data?: ... }`; errors return the matching HTTP status with `success: false`.
- Auth: `Authorization: Bearer <token>` header. Tokens are stored in `localStorage` (`token` and `user` keys) by the frontend; logout clears them.
- Route handlers are `async` with try/catch; the global error middleware in `server.js` catches anything that escapes.
- Route files carry JSDoc-style header comments, e.g. `// @route POST /api/auth/register  // @access Public` — keep this style when adding routes.

### Frontend

- `frontend/js/main.js` — shared script loaded by every page. Defines `utils` (formatting, clipboard, debounce), an `api` object wrapping `fetch` (injects the Bearer token), and auth helpers (`isAuthenticated`, `requireAuth`, `logout`, role-based redirect to `admin/` vs `user/` pages).
- `frontend/login.html` — combined login/register/landing entry.
- `frontend/user/*.html` — authenticated user pages (dashboard, deposit, withdraw, transfers between checking/savings, invest, loans with repayments, KYC wizard, cards, crypto prices/wallets, referrals, support chat, transactions, activity, notifications, wallet settings, user settings).
- `frontend/admin/*.html` — admin pages mirroring the same feature set (user management with reasoned credit/debit, deposits, withdrawals, KYC review, loans, investment/loan plans, card applications, transfers, crypto deposit wallets, messages, logs, platform settings) plus the admin dashboard.
- Each page includes its own inline `<script>` block for page logic on top of `main.js`, and links `css/styles.css` + Font Awesome via CDN.

## Development Conventions

- CommonJS modules throughout (`require` / `module.exports`); no ES modules, no TypeScript, no transpilation.
- 2-space indentation, single quotes in JS, camelCase identifiers, semicolons.
- Business rules worth knowing before touching money-related code:
  - Referral bonus is a flat **$50** credited to the referrer on registration (`routes/auth.js`).
  - Investment return = `amount + amount * ROI / 100`, credited by the hourly cron when `endDate` passes (`server.js`).
  - Users hold two balances: `balanceUSD` (checking) and `savingsBalance` (savings). Internal transfers between them use `routes/transfers.js` with idempotency keys.
  - Balances change only through `utils/ledger.js`, and every change creates a `Transaction` record.
- File naming: models are PascalCase (`User.js`), routes are camelCase (`investmentPlans.js`) — follow the existing file when adding siblings.

## Security Considerations

- Never commit real secrets: `backend/.env` holds `JWT_SECRET` and DB credentials; uploaded user documents live under `backend/uploads/`.
- JWT secret falls back to a hardcoded development value with a loud console warning; startup throws if `JWT_SECRET` is missing in production. Always set it in `.env`.
- CORS is restricted to `CORS_ORIGIN` (defaults to localhost dev origins) — widen deliberately for deployment.
- Auth endpoints are rate-limited (10 req/15 min on `/api/auth`, 3 req/15 min on resend-verification); login lockout after 5 failures (15 min).
- Email verification (6-digit code, hashed, 15-min expiry, single-use), password reset (hashed token, 1-h expiry), welcome, optional login OTP (`LOGIN_OTP=true`, 10-min code via `sendLoginOtp` + `/api/auth/verify-login-otp`), security alerts, and transaction emails all go through `utils/emailService.js`. Tokens are never logged.
- KYC never collects bank passwords or card numbers; seed-phrase/private-key collection was removed entirely. KYC documents are owner/admin-only via `/api/files`.
- All money movement goes through `utils/ledger.js`; admin balance changes require a reason and write an AdminLog entry.
- The project presents itself as a banking/investment platform; there is no real payment-processor or blockchain integration — deposits are manual proof-upload requests approved by an admin, and crypto buy/sell/send stay disabled until an execution/custody provider is configured. Do not claim regulatory compliance.

## Deployment

No deployment configuration exists (no Dockerfile, CI pipeline, or hosting manifests). The documented model is: run the backend with `npm start`, serve `frontend/` with any static file server, point a MongoDB instance at `MONGODB_URI`, and change the hardcoded `API_BASE_URL` in `frontend/js/main.js` to the production API origin.
