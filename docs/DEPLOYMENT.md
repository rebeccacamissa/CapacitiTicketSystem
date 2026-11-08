# Deployment and GitHub

## Architecture

One Node.js service serves **both** the frontend (the static files in `public/`) and the REST API (`/api/*`). So the submission's "frontend link" and "backend link" are the same domain:

| Submission item | Value |
|---|---|
| Frontend | `https://<your-app>.onrender.com/` |
| Backend (API base) | `https://<your-app>.onrender.com/api` |
| Backend health check | `https://<your-app>.onrender.com/api/health` → `{"status":"ok"}` |

> If your assessors insist on two separate links, you can host `public/` on a static host (Netlify or Vercel) and the API on Render. That needs CORS and cross-site cookies (`SameSite=None; Secure`), which weakens the CSRF protection. A single origin is recommended.

SQLite needs a **persistent disk**. Uploaded attachments are also written to disk.

## Option A: Render (recommended, blueprint included)

1. Push the code to GitHub (see below).
2. In Render, choose **New → Blueprint** and select the repository. Render reads `render.yaml`, which defines:
   - the build: `npm ci --include=dev && npm run build:css && npm run i18n`;
   - the start command: `npm run start:prod`, which seeds demo data only if the database is empty and then starts the server;
   - a 1 GB persistent disk at `/var/data` for `capaciti.db` and uploads;
   - a generated `JWT_SECRET`, `NODE_ENV=production`, and the demo flags.
3. Wait for the deploy, then open `/api/health`.

> **Cost note:** persistent disks need a paid Render instance (Starter). On the free plan the service sleeps, and the database and uploads are wiped on every deploy or restart. That's acceptable for a short demo, but not for real use.

## Option B: Docker (Railway, Fly.io, any VPS)

```bash
docker build -t capaciti-support .
docker run -p 3000:3000 -v capaciti-data:/data \
  -e JWT_SECRET="$(openssl rand -hex 48)" \
  -e DEMO_MODE=true -e ALLOW_DEMO_IN_PRODUCTION=true \
  capaciti-support
```

The image builds the CSS and translations, runs as a non-root user, keeps its data in the `/data` volume, and includes a health check. On Railway, attach a volume at `/data`. On Fly.io, use `fly launch`, then `fly volumes create data`, and mount it at `/data`.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | yes (prod) | `development` | `production` enables secure cookies and hides error details |
| `JWT_SECRET` | **yes** | dev-only value | At least 32 random characters. The app refuses to start in production without it. |
| `PORT` | no | 3000 | Most hosts set this automatically |
| `DB_PATH` | no | `./data/capaciti.db` | Point it at the persistent disk |
| `UPLOAD_DIR` | no | `./data/uploads` | Point it at the persistent disk |
| `JWT_EXPIRES_IN` | no | `8h` | |
| `BCRYPT_ROUNDS` | no | 12 | |
| `DEMO_MODE` | no | off | One-click role sign-in and the "View as" switcher |
| `ALLOW_DEMO_IN_PRODUCTION` | no | off | Must **also** be `true` for demo mode to work in production. **Switch it off for real users.** |

## After deploying

- [ ] `/api/health` returns OK.
- [ ] Sign in with each demo role; the role switcher works.
- [ ] Create a request, attach a file, and move it through the workflow as Thabo.
- [ ] Restart the service. The data is still there (this confirms the disk is mounted).
- [ ] The URL uses HTTPS, so the secure cookie is set.
- [ ] Before real users arrive: turn demo mode off, change the demo passwords or delete the demo users, and have native speakers review the translations.

## Creating the GitHub repository

The project is not yet a Git repository. From the project folder:

```bash
git init
git add .
git commit -m "CAPACITI Candidate Support & Service Request System"
git branch -M main
# create an empty repository on github.com first (no README), then:
git remote add origin https://github.com/rebeccacamissa/CapacitiTicketSystem.git
git push -u origin main
```

**Do not commit secrets.** `.gitignore` already excludes `.env`, `data/` (the database and uploads), `node_modules/` and the generated CSS. `.env.example` documents the variables instead.

If your brief expects **separate frontend and backend repositories**, the code is cleanly split into `public/` (frontend) and `server/` (backend). They can be pushed as two repositories, but you would then need Option B-style hosting with CORS as described above. A single repository with clearly separated folders is usually accepted for a monolith; check with your facilitator.

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
