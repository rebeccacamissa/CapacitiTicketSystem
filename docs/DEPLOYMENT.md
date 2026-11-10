# Deployment and GitHub

## Architecture

One Node.js service serves **both** the frontend (the static files in `public/`) and the REST API (`/api/*`). So the submission's "frontend link" and "backend link" are the same domain:

| Submission item | Value |
|---|---|
| Frontend | `https://<your-app>.onrender.com/` |
| Backend (API base) | `https://<your-app>.onrender.com/api` |
| Backend health check | `https://<your-app>.onrender.com/api/health` → `{"status":"ok"}` |

> If your assessors insist on two separate links, you can host `public/` on a static host (Netlify or Vercel) and the API on Render. That needs CORS and cross-site cookies (`SameSite=None; Secure`), which weakens the CSRF protection. A single origin is recommended.

**Data storage.** Everything (including uploaded files) is stored in **PostgreSQL**:

| `DATABASE_URL` | What the app uses | Survives redeploys? |
|---|---|---|
| Set (e.g. Neon) | Your Postgres server | **Yes**, on any plan, including Render's free plan |
| Not set | Embedded Postgres (PGlite) in `PGLITE_DIR` | Only if that folder is on a persistent disk |

## Step 1: Create the database (Neon)

1. Install the Neon CLI and sign in (this opens your browser): `npm i -g neon@latest`, then `neon login`.
2. From the project folder, create a project in your organisation and write its connection string into `.env`:
   `neon init --org-id <your-org-id> --region-id <region> --project-name capaciti-support`
   (You can also create the project at console.neon.tech and copy the connection string.)
3. Use the **pooled** connection string as `DATABASE_URL`. Neon requires SSL; the app enables it automatically.
4. Optional: copy your existing local SQLite data into it with `npm run db:copy-sqlite` (see below). Otherwise the first start seeds demo data.

The schema is created automatically on start-up (every statement is idempotent), so there is no separate migration step.

## Step 2: Email (Resend), optional but recommended

Password-reset links and notifications (stage decisions, ticket replies, review requests, interview invitations, placements) are sent with [Resend](https://resend.com).

1. Create a Resend account and an API key.
2. Verify your sending domain in Resend, then set `EMAIL_FROM` to an address on it (e.g. `CAPACITI Support <support@yourdomain.org>`). Resend's test sender `onboarding@resend.dev` only delivers to your own Resend account address.
3. Set `RESEND_API_KEY` and `EMAIL_FROM` on the host.

Without a key, the app still works: every email is written to the server log (and recorded as `logged` in the `email_log` table) instead of being sent. Note that without email, users can only get a new password from an administrator.

## Step 3: Render

1. Push the code to GitHub.
2. In Render, choose **New → Blueprint** and select the repository (or update your existing web service's settings to match `render.yaml`). The blueprint defines:
   - the build: `npm ci --include=dev && npm run build:css && npm run i18n`;
   - the start command: `npm run start:prod` (seeds demo data only if the database is empty, then starts the server);
   - `NODE_ENV=production`, a generated `JWT_SECRET`, and the demo flags.
3. In the service's **Environment** tab, add the secrets: `DATABASE_URL`, and optionally `RESEND_API_KEY`, `EMAIL_FROM` and `ANTHROPIC_API_KEY`. Never commit them.
4. Wait for the deploy, then open `/api/health`. The log line `Database: Postgres (DATABASE_URL)` confirms the persistent database is in use.

## Option B: Docker (Railway, Fly.io, any VPS)

```bash
docker build -t capaciti-support .
docker run -p 3000:3000 \
  -e JWT_SECRET="$(openssl rand -hex 48)" \
  -e DATABASE_URL="postgres://…" \
  -e DEMO_MODE=false \
  capaciti-support
```

Without `DATABASE_URL`, mount a volume at `/data` so the embedded database persists.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | yes (prod) | `development` | `production` enables secure cookies and hides error details |
| `JWT_SECRET` | **yes** | dev-only value | At least 32 random characters. The app refuses to start in production without it. |
| `DATABASE_URL` | **yes (prod)** | – | Postgres connection string (Neon). Without it data is not persistent on most hosts. |
| `PGLITE_DIR` | no | `./data/pglite` | Embedded database folder when `DATABASE_URL` is not set |
| `PORT` | no | 3000 | Most hosts set this automatically |
| `JWT_EXPIRES_IN` | no | `8h` | |
| `BCRYPT_ROUNDS` | no | 12 | |
| `DEMO_MODE` | no | off | `true`: one-click demo sign-in and the "Preview as" switcher. `false`: individual accounts only. |
| `ALLOW_DEMO_IN_PRODUCTION` | no | off | Must **also** be `true` for demo mode to work in production. **Switch it off for real users.** |
| `RESEND_API_KEY` | no | – | Sends email through Resend; without it emails are logged |
| `EMAIL_FROM` | with Resend | `onboarding@resend.dev` | Sender on a domain verified in Resend |
| `APP_URL` | no | Render's URL | Public address used in email links |
| `ANTHROPIC_API_KEY` | no | – | Enables AI CV tailoring and the AI mock interviewer |
| `ALLOW_DB_RESET` | no | – | Must be `true` for `npm run db:reset` to wipe a `DATABASE_URL` database |

## Moving existing SQLite data to Postgres

Earlier versions stored data in `data/capaciti.db`. To bring it across (users, requests, audit trail, progress, stages, portfolio, uploaded files):

```bash
# with DATABASE_URL set in .env (or unset to fill the embedded database)
npm run db:copy-sqlite              # reads data/capaciti.db and data/uploads
```

The target must be empty, ids are preserved, and the copy is a single transaction (all or nothing). The SQLite file is opened read-only.

## Production mode checklist

- [ ] `DATABASE_URL` set; the start-up log shows `Database: Postgres (DATABASE_URL)`.
- [ ] `/api/health` returns OK.
- [ ] `DEMO_MODE=false`: the sign-in page shows no demo buttons and `/api/auth/demo-login` returns 404.
- [ ] Delete the demo users or change their passwords; create real accounts in the Control centre.
- [ ] `RESEND_API_KEY` and `EMAIL_FROM` set; "Forgot your password?" delivers an email.
- [ ] Restart the service: the data is still there.
- [ ] Native speakers have reviewed the translations.

## Creating the GitHub repository

```bash
git remote add origin https://github.com/rebeccacamissa/CapacitiTicketSystem.git
git push -u origin main
```

**Do not commit secrets.** `.gitignore` excludes `.env`, `data/` (local databases and uploads), `node_modules/` and the generated CSS. `.env.example` documents the variables instead.

## Submission checklist

| Item | Where |
|---|---|
| Deployed application | Your Render or Docker URL (above) |
| Frontend and backend links | Same domain: `/` and `/api` (above) |
| GitHub repository | Your repository URL |
| README | [`README.md`](../README.md) |
| API documentation | [`docs/API.md`](API.md) |
| Database diagram | [`docs/DATABASE.md`](DATABASE.md) (Mermaid ER diagram) |
| User-role explanation | [`docs/USER-ROLES.md`](USER-ROLES.md) |
| Testing evidence | [`docs/TESTING.md`](TESTING.md), [`test-results.txt`](test-results.txt), [`db-enforcement-demo.txt`](db-enforcement-demo.txt) |
| Screenshots | [`docs/SCREENSHOTS.md`](SCREENSHOTS.md), [`docs/screenshots/`](screenshots) |
| Known limitations and future recommendations | [`docs/LIMITATIONS-AND-ROADMAP.md`](LIMITATIONS-AND-ROADMAP.md) |
