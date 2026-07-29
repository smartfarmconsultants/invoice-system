# Invoice System — Hybrid Architecture

This project follows the hybrid architecture you specified:

| Component        | Implementation                                      |
|-------------------|------------------------------------------------------|
| Public Website    | `public-site/` — plain static HTML/CSS, no backend   |
| Invoice System    | `app/` — dynamic Node.js + Express + PostgreSQL app  |
| Hosting           | Deployable to Render (recommended) or HostPinnacle   |
| Database          | PostgreSQL (MySQL-compatible schema also provided)   |
| Authentication    | Required — bcrypt-hashed passwords, sessions, RBAC   |
| PDF Export        | Server-side, generated with PDFKit (no external API) |

```
invoice-system/
├── public-site/          ← static marketing/landing page (deploy as a Static Site)
└── app/                  ← the actual invoice system (deploy as a Web Service)
    ├── server.js
    ├── db/schema.sql     ← PostgreSQL schema
    ├── db/schema.mysql.sql
    ├── scripts/seed.js   ← creates real accounts with strong random passwords
    ├── middleware/auth.js
    ├── routes/
    └── views/
```

## Why two separate deployments?

Splitting a static public site from the dynamic, authenticated invoice
system is a real security boundary, not just an organizational one:

- The public site has **no database connection, no secrets, and no attack
  surface** beyond serving HTML/CSS. It can be hosted anywhere cheap/free
  (Render Static Site, Netlify, HostPinnacle static hosting, etc.).
- The invoice system is the only component that talks to the database and
  handles authentication. Keeping it isolated means a compromise of the
  public site (e.g. someone finds an old WordPress plugin bug) can't touch
  invoice data, and vice versa — the app server is never exposed to
  unauthenticated crawlers of the marketing site.
- You can scale, patch, or take down either piece independently.

Link the two by pointing a "Client Login" button on the static site at the
invoice app's URL (e.g. `https://invoices.yourcompany.com`).

## 1. Local setup

```bash
cd app
cp .env.example .env        # fill in DATABASE_URL and SESSION_SECRET
npm install
npm run migrate             # creates tables
npm run seed                # creates the 3 accounts below and prints their passwords ONCE
npm start
```

Visit http://localhost:3000

## 2. Login accounts

**No passwords are hardcoded in this repo.** Running `npm run seed`
generates a cryptographically random 16-character password for each of the
three built-in accounts, hashes it with bcrypt before storing it, and
prints the plaintext **once** to your terminal (and to a local, gitignored
`credentials.txt`) so you can hand it to the right person. All three
accounts are also flagged `must_change_password = true`, so the app forces
a password reset on first login — the generated password is never anyone's
long-term password.

| Role          | Email                        |
|---------------|-------------------------------|
| Administrator | admin@yourcompany.com         |
| Manager       | manager@yourcompany.com       |
| Invoice Clerk | clerk@yourcompany.com         |

Change these emails in `scripts/seed.js` before running it, then delete
`credentials.txt` after distributing the passwords.

## 3. Deploying to Render (recommended)

1. Push this repo to GitHub.
2. In Render: **New → PostgreSQL** — create a free/starter Postgres instance, copy its internal connection string.
3. In Render: **New → Web Service**, point it at the `app/` folder (set root directory to `app`), build command `npm install`, start command `npm start`.
4. Add environment variables: `DATABASE_URL` (from step 2), `SESSION_SECRET` (any long random string), `NODE_ENV=production`.
5. After first deploy, open the Render **Shell** for the service and run `npm run migrate && npm run seed` once.
6. In Render: **New → Static Site**, point it at `public-site/` for the marketing page (optional, separate deploy).

## 4. Deploying to HostPinnacle (cPanel-style shared hosting)

HostPinnacle's shared plans are typically PHP/MySQL-oriented with Node.js
available via cPanel's "Setup Node.js App" tool on higher tiers:

1. Upload `public-site/` to `public_html/` (or a subdomain) via File Manager/FTP — this is your static site, works on any plan.
2. Create a MySQL database in cPanel and import `app/db/schema.mysql.sql` via phpMyAdmin.
3. Under **Setup Node.js App**, create a new app pointed at the `app/` folder, set the Node version, and set environment variables (`DATABASE_URL` pointing at the MySQL/Postgres instance HostPinnacle provides, `SESSION_SECRET`).
4. Use cPanel's terminal (or SSH) to run `npm install`, `npm run migrate`, `npm run seed`.
5. Point a subdomain (e.g. `invoices.yourcompany.com`) at the Node app.

If your HostPinnacle plan only offers MySQL (not PostgreSQL), use
`db/schema.mysql.sql` and set `DB_DRIVER=mysql` in `.env` — the app's
query layer (`app/db/index.js`) supports both.

## 5. Security features already implemented

- Passwords hashed with **bcrypt** (cost factor 12), never stored in plaintext.
- Sessions stored server-side (`connect-pg-simple` / MySQL session store), signed with `SESSION_SECRET`, `httpOnly` + `secure` cookies in production.
- **CSRF protection** on all state-changing forms.
- **Parameterized queries** everywhere (no string-concatenated SQL).
- **Role-based access control** middleware (`admin`, `manager`, `clerk`) enforced on every route, not just hidden in the UI.
- **Audit log** table recording who created/edited/deleted each invoice.
- Login rate limiting (5 attempts / 15 min per IP) to slow brute force.
- Forced password change on first login for seeded accounts.
- `.env` / credentials are gitignored — nothing sensitive is committed.

## 6. Still required from you before going live

- A real HTTPS certificate (Render provides this automatically; on HostPinnacle enable AutoSSL/Let's Encrypt in cPanel).
- Point DNS for your domain at whichever host you choose.
- Set up automated daily database backups (Render Postgres has a backup add-on; HostPinnacle cPanel has a Backup Wizard).
- Optionally enable 2FA — a `TODO` stub is left in `routes/auth.js` for adding TOTP (e.g. via the `otplib` package) if you want it later.
