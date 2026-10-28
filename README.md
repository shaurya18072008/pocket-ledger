# Pocket Ledger — v1

A multi-account personal expense tracker with a calm landing page, password-protected ledgers, a one-click demo, and the original Pocket Ledger dashboard. This project is licensed under the MIT License; see [`LICENSE`](LICENSE).

## Run locally

```bash
npm ci
npm start
```

Open `http://localhost:3000`. Run `npm test` whenever you want to verify the project. Local development uses SQLite at `data/pocket-ledger.sqlite`; on first run it creates the tables, and new accounts start with an empty ledger. The SQLite file is intentionally ignored by Git so personal data does not go into the repository.

Choose **Take a look around** to open a static, read-only dashboard filled with fictional sample values. It creates no account, session, or saved data; use **Back to Homepage** when you are ready to leave it. To create a private ledger, choose **Create account** and enter a name and password. Names are unique regardless of letter case. In your personal dashboard, add expenses manually or import up to 500 rows from CSV or JSON (all rows are validated before anything is saved). The account dashboard stays available across refreshes; use your browser’s Back button or choose **Log out** from the initial avatar at the top right to return to the landing page.

CSV imports accept headers such as `Date,Description,Category,Amount (INR),Note` (date must be `YYYY-MM-DD`). JSON can be an array of objects or an object containing an `expenses`/`transactions` array. Each record needs `description`, `amount`, `category`, and `spent_on`; `note` is optional. Amounts may include rupee signs and thousands separators in CSV. Imports are account-scoped and all-or-nothing.

## Deploy to Netlify Free from GitHub

Netlify Functions run the API. For persistent multi-user data on Netlify’s Free plan, this version uses **Neon Postgres** (free Neon project) rather than trying to write SQLite to Netlify’s temporary function filesystem. Netlify’s own managed Postgres is for credit-based plans; Neon’s current Free plan is listed at [neon.com/pricing](https://neon.com/pricing).

1. Create a Neon project on its Free plan and copy the pooled Postgres connection string from its dashboard.
2. Commit this project to GitHub and create a Netlify site from that repository. Netlify should use the included `netlify.toml`; no build command is needed.
3. In Neon’s SQL Editor, run the SQL in `db/migrations/001_create_pocket_ledger.sql` once. That creates the account and expense tables.
4. In Netlify’s environment variables, add **`DATABASE_URL`** (the Neon connection string) and **`SESSION_SECRET`** (a separate, long random string used only to sign sessions). Generate a session secret with `openssl rand -base64 48`. Keep both values private; do not commit them to GitHub.
5. Deploy. Netlify builds the serverless API; the landing page, demo, sign-up, and private dashboard are ready.

The two Netlify variables are site-wide infrastructure settings, **not per-user passwords**. Each person chooses their own password on sign-up; the app stores a bcrypt hash in that account’s row. Their expenses are filtered by that account on every API request. Locally, the app uses SQLite, so you don’t need either variable to try it.

## Privacy and accounts

- Signup accepts a display name and password only. Passwords are hashed with bcrypt; the original password is never saved.
- The signed session is an `HttpOnly`, `SameSite=Lax` cookie, marked `Secure` on HTTPS. Sessions expire after seven days; logging out clears the cookie. For local sandbox previews only, sign-in also supplies a matching seven-day token so the same account dashboard survives refreshes when embedded browsers block cookies; production remains cookie-only.
- All expense reads, summaries, edits, deletes, imports, and CSV exports are scoped to the signed-in account in the backend. Production serves the dashboard only for a valid session; locally, the dashboard shell itself contains no private data and its API remains authenticated.
- The demo is a static illustration. Its example values are fictional, read-only, and never saved. It is separate from user accounts.
- This v1 does not include password reset or account recovery because accounts do not collect an email address.

## Tests

```bash
npm test
```

Tests cover expense validation, signup/password rules, sign-in (including the local preview token), private API access, account isolation, all-or-nothing batch imports, expense CRUD/filtering, logout, static read-only demo behavior, and CSV escaping.

## REST API

All expense routes require a valid signed-in session. Production uses the session cookie; the local sandbox also accepts the same seven-day signed token used to keep embedded dashboard refreshes authenticated. Auth routes issue or clear the cookie.

| Method | Route | What it does |
|---|---|---|
| `GET` | `/api/auth/status` | Check whether this browser has a signed-in session |
| `POST` | `/api/auth/signup` | Create an account from `name` and `password` |
| `POST` | `/api/auth/login` | Sign in with `name` and `password` |
| `POST` | `/api/auth/logout` | Clear the session cookie |
| `GET` | `/api/categories` | List available categories |
| `GET` | `/api/expenses` | List this account’s expenses; optional `month`, `category`, `search`, `from`, `to`, and `limit` filters |
| `GET` | `/api/expenses/:id` | Read one of this account’s expenses |
| `POST` | `/api/expenses` | Add an expense |
| `POST` | `/api/expenses/import` | Import 1–500 validated expenses atomically from CSV/JSON-parsed records |
| `PATCH` | `/api/expenses/:id` | Edit an expense owned by this account |
| `DELETE` | `/api/expenses/:id` | Delete an expense owned by this account |
| `GET` | `/api/summary?month=YYYY-MM` | Monthly totals, category totals, daily spending, and comparison with the previous month |
| `GET` | `/api/export.csv` | Download this account’s ledger as CSV |

Expense JSON uses `description`, `amount`, `category`, and `spent_on` (`YYYY-MM-DD`); `note` is optional.
