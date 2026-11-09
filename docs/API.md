# API documentation

Base URL: `https://<your-deployment>/api` (locally `http://localhost:3000/api`).
The frontend and the API are served by the **same** Express app, so there is no CORS setup and the auth cookie is first-party.

## Conventions

| Topic | Rule |
|---|---|
| Format | JSON in, JSON out (`Content-Type: application/json`). Body limit is 100 KB, or 36 MB for attachment uploads. |
| Authentication | JWT stored in an **httpOnly, SameSite=Strict** cookie named `capaciti_token`, set by `/auth/login` or `/auth/register`. API clients may instead send `Authorization: Bearer <token>`. |
| Authorisation | Role-based: `candidate`, `support`, `admin`, `recruiter`. "Staff" below means `support` **or** `admin`. Recruiters can read only published candidate portfolios and cannot access requests, workflow, or candidate-management endpoints. Candidates get **404 (not 403)** for other people's records, so the API never reveals that a record exists. |
| Dates | ISO 8601 UTC strings, e.g. `2026-11-08T10:15:30.120Z`. Dates of birth are `YYYY-MM-DD`. |
| Rate limits | `/auth/register`, `/auth/login` and `/auth/change-password` allow 20 requests per 15 minutes per IP. `/cammy/chat` allows 40 per minute. Over the limit you get `429 RATE_LIMITED` with a `Retry-After` header. |
| Temporary passwords | Accounts created by an admin get `403 PASSWORD_CHANGE_REQUIRED` on every endpoint except `/auth/me`, `/auth/change-password` and `/auth/logout` until the password is changed. |

### Error shape

Every error looks like this:

```json
{ "error": { "code": "ILLEGAL_STATUS_TRANSITION", "message": "Cannot move a request from \"Open\" to \"Closed\". Allowed next: Assigned.",
             "details": { "enforcedBy": "application", "from": "Open", "to": "Closed", "allowed": ["Assigned"] } } }
```

| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_ERROR` (with `details.fields` listing each field's message), `INVALID_JSON` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` |
| 403 | `FORBIDDEN`, `ACCOUNT_DISABLED`, `PASSWORD_CHANGE_REQUIRED` |
| 404 | `NOT_FOUND` |
| 409 | **Workflow, application layer:** `ILLEGAL_STATUS_TRANSITION`, `NO_CHANGE`, `UNKNOWN_STATUS`, `REQUEST_FINALISED`, `REQUEST_CLOSED`, `NOT_RESOLVED` |
|     | **Workflow, database layer** (raised by SQLite triggers): `DB_ILLEGAL_TRANSITION`, `DB_ASSIGNEE_REQUIRED`, `DB_RESOLUTION_REQUIRED`, `DB_AUDIT_REQUIRED`, `DB_INVALID_ASSIGNEE`, `DB_AUDIT_LOG_IMMUTABLE` |
|     | **Data:** `EMAIL_TAKEN`, `EMPLOYEE_ID_TAKEN`, `DUPLICATE`, `HAS_ACTIVE_ASSIGNMENTS`, `USER_HAS_HISTORY` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` (no internal details are exposed in production) |

---

## 1. Health

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/health` | Public | `{ "status": "ok" }`. Used by hosting health checks. |

## 2. Authentication (`/auth`)

| Method | Path | Access | Body / query | Response |
|---|---|---|---|---|
| POST | `/auth/register` | Public | `firstName`, `surname`, `dateOfBirth` (`YYYY-MM-DD`, age 15–100), `gender` (`female`\|`male`\|`non-binary`\|`prefer-not`), `email`, `password` (8+ chars with upper-case, lower-case and a digit). Optional: `cohort`, `stream`, `mentor`, `techChamp`, `supervisor` | `201 { user }`. Always creates a **candidate** and sets the auth cookie. |
| POST | `/auth/login` | Public | `email`, `password` | `200 { user }` and sets the cookie. `user.mustChangePassword` tells the client to redirect. |
| POST | `/auth/logout` | Any | – | `204` and clears the cookie. |
| GET | `/auth/me` | Signed in | – | `{ user, demoMode }`. `user` includes `role`, `avatar`, `preferences`, `language`, `tourDone` and `mustChangePassword`. |
| POST | `/auth/change-password` | Signed in | `currentPassword`, `newPassword` | `{ ok: true }`. Clears the temporary-password flag. |
| GET | `/auth/demo-accounts` | Public | – | `{ enabled, accounts[] }`. Only populated when `DEMO_MODE` is on. |
| POST | `/auth/demo-login` | Public (demo only) | `role` | Signs in as the seeded demo user for that role. Returns 404 when demo mode is off. |

**Example**

```bash
curl -c jar.txt -H "Content-Type: application/json" \
     -d '{"email":"thabo@capaciti.org.za","password":"Capaciti@2026"}' http://localhost:3000/api/auth/login
```

## 3. Support requests (`/requests`)

| Method | Path | Access | Body / query | Response |
|---|---|---|---|---|
| GET | `/requests/categories` | Candidate or staff | – | Active categories (`id`, `name`, `description`, `is_blocker`). |
| GET | `/requests/staff` | Staff | – | Active support and admin users, used for assignment. |
| GET | `/requests` | Candidate or staff (candidates see only their own) | `q`, `status` (or `active`), `categoryId`, `priority`, `assigned` (`me`\|`unassigned`\|user id, staff only), `overdue`, `sort` (`created`\|`updated`\|`due`\|`priority`\|`reference`\|`status`), `order` (`asc`\|`desc`), `page`, `pageSize` (5–100) | `{ items[], total, page, pageSize, pages }` |
| POST | `/requests` | Candidate | `title` (5–150), `description` (10–5000), `categoryId`, `priority` (`Low`\|`Medium`\|`High`\|`Urgent`, default `Medium`) | `201 { request, badges[] }`. Generates a reference such as `REQ-2026-0042` and calculates the SLA due date. |
| GET | `/requests/:id` | Owner or staff | – | `{ request, messages[], allowedNext[], attachments[], rating }`. Internal notes, internal files and the candidate's e-mail and accessibility needs are only sent to staff. |
| POST | `/requests/:id/attachments` | Owner or staff | `{ files: [{ name, data: "data:<mime>;base64,…" }], isInternal? }`. Up to 5 files of 5 MB each. | `201 { ids[] }`. The real file type is checked from the file contents, not the name. |
| GET | `/requests/attachments/:id` | Owner or staff | – | The file, sent with `X-Content-Type-Options: nosniff` and a sandboxed CSP. Images are shown inline; other files download. |
| POST | `/requests/:id/rating` | Candidate (owner) | `rating` (1–5), `comment?` | `{ ok, badges[] }`. Only allowed once the request is Resolved or Closed; can be updated. |

## Recruiter workspace (`/recruiter`)

Recruiter accounts are created or assigned by an administrator. A candidate's portfolio is private by default; only the candidate can edit it or publish it. Recruiter endpoints return candidate identity and portfolio details only while publication is enabled.

| Method | Path | Access | Body / query | Response |
|---|---|---|---|---|
| GET | `/recruiter/me` | Candidate | – | The signed-in candidate's portfolio and projects, including private drafts. |
| PATCH | `/recruiter/me` | Candidate | Optional `isPublished`, `headline`, `summary`, comma-separated `skills`, HTTPS `githubUrl`, HTTPS `cvUrl` | `{ portfolio }`. |
| POST | `/recruiter/me/projects` | Candidate | `title`, optional `description`, HTTPS `projectUrl`, HTTPS `evidenceUrl` | `201 { project }`. |
| DELETE | `/recruiter/me/projects/:projectId` | Project owner | – | `204`. |
| GET | `/recruiter/summary` | Recruiter | – | Visible profile, work-ready, placed, and active-stream counts. |
| GET | `/recruiter/talent` | Recruiter | Optional `q`, `stream`, `stage` | Published candidate rows and filter options. |
| GET | `/recruiter/profiles/:id` | Recruiter | – | Published profile, verified programme requirements, and projects. Unpublished profiles return 404. |
| GET | `/recruiter/portfolios` | Recruiter | – | Published profiles and project evidence. |
| GET | `/recruiter/shortlist` | Recruiter | – | The signed-in recruiter's private shortlist (published candidates only), with notes. |
| PUT | `/recruiter/shortlist/:id` | Recruiter | Optional `note` (≤ 500) | Adds or updates a shortlist entry. 404 if the candidate isn't published. |
| DELETE | `/recruiter/shortlist/:id` | Recruiter | – | Removes the entry. |

Talent rows now carry the **official** `stage` / `stageLabel` (from stage decisions), `shortlisted`, `shortlistNote` and `fileCount`. Profiles include `files` (portfolio documents).

## Official stages (`/stages`)

Stages: `enrolled` → `training` → `work_ready` → `placed` → `completed`. Rules are enforced in the service **and** by triggers (see [DATABASE.md](DATABASE.md)).

| Method | Path | Access | Body / query | Response |
|---|---|---|---|---|
| GET | `/stages` | Signed in | – | `{ stages }` in order |
| GET | `/stages/candidates` | Admin, Facilitator (own streams) | – | Candidates with `stage`, `evidenceDone/Total` for the current stage, `nextStage`, `readyForReview` |
| GET | `/stages/pipeline` | Admin, Facilitator (own streams) | – | `total`, `byStage`, `awaitingReview`, `byStream` (stream × stage counts) |
| POST | `/stages/candidates/:id/decisions` | Admin, Facilitator (own streams) | `toStage`, `reason` | `201 { decision, fromStage, toStage, direction }`. Errors: `STAGE_SKIP`, `STAGE_UNCHANGED` (409), `STAGE_BACKWARD_ADMIN_ONLY` (403), 400 if the reason is missing (backward needs ≥ 10 characters), 404 outside the facilitator's streams |
| GET | `/stages/decisions` | Admin (all), Facilitator (own streams), Candidate (own) | Optional `candidateId`, `limit` | `{ decisions }`: who, when, why, from → to, direction |

## Portfolio documents and AI CV tailoring (`/portfolio`)

| Method | Path | Access | Body | Response |
|---|---|---|---|---|
| GET | `/portfolio/files` | Candidate | – | Own files (`kind`: `cv` / `project` / `certificate`) |
| POST | `/portfolio/files` | Candidate | `kind`, optional `title`, `name`, `data` (base64 data URL) | `201 { file }`. Same checks as ticket attachments: allowed type per kind, magic bytes, 5 MB, max 20 files |
| DELETE | `/portfolio/files/:id` | Owner | – | `204` |
| GET | `/portfolio/files/:id` | Owner; support/admin; facilitator for the candidate's stream; recruiter only while published | – | The file, served with a sandbox CSP and `nosniff` (404 otherwise) |
| GET | `/portfolio/cv/ai-status` | Candidate | – | `{ enabled }` (true when `ANTHROPIC_API_KEY` is set) |
| POST | `/portfolio/cv/tailor` | Candidate (10 per hour) | `jobTitle`, optional `jobDescription`, `fileId` (own PDF/TXT CV) **or** `cvText`, `consent: true` | `{ result: { tailoredCv, changes[], gapsNotAdded[], honestyNotes, numbersToCheck } }`. Nothing is saved. `503 AI_NOT_CONFIGURED` without a key |
| POST | `/portfolio/cv/tailored` | Candidate | `title`, `text` (the reviewed, possibly edited draft) | `201 { file }` saved as a text CV with `source: ai_tailored` |
## 4. Workflow (`/workflow`): transaction-backed state machine

| Method | Path | Access | Body | Response |
|---|---|---|---|---|
| GET | `/workflow/rules` | Candidate or staff | – | Statuses, priorities, transitions (read from the `status_transitions` table) and the moves candidates are allowed to make. |
| POST | `/workflow/requests/:id/transition` | Per role rules | `toStatus`, `note?` (internal), `message?` (sent to the candidate), `resolution?` (required for `Resolved`), `assigneeId?`, `override?` (admin only) | `{ request, allowedNext[], badges[] }` |
| POST | `/workflow/requests/:id/assign` | Staff | `assigneeId`, `note?` | `{ request }`. Moves Open or Reopened requests to Assigned. |
| POST | `/workflow/requests/:id/priority` | Staff | `priority`, `note?` | `{ request }`. Recalculates the SLA due date. |
| POST | `/workflow/requests/:id/messages` | Owner or staff | `body`, `isInternal?` (staff only) | `201 { autoTransitioned }`. A candidate reply on *Waiting for Candidate* automatically moves the request back to *In Progress*. |
| GET | `/workflow/requests/:id/history` | Owner or staff | – | Audit trail. Candidates don't see internal notes or assignment entries. |
| POST | `/workflow/db-probe` | Admin | `requestId`, `toStatus`, `withAudit` | Skips application validation and sends raw SQL to SQLite. **Always rolled back.** Returns `409 DB_ILLEGAL_TRANSITION` when the database trigger blocks the move. |

**Transition pipeline:** `BEGIN IMMEDIATE`, then load and authorise, check the application rules, issue an admin override token if needed, insert the `audit_log` row, `UPDATE requests` (the trigger re-checks the move), add any message, and `COMMIT`. If any step fails, everything is rolled back.

## 5. Dashboards and analytics

| Method | Path | Access | Response |
|---|---|---|---|
| GET | `/analytics/summary` | Staff | `totals` (total, open, in progress, waiting, resolved, overdue, unassigned, average resolution hours), `byStatus`, `byCategory`, `byPriority`, `workload` (per staff: active, overdue, resolved, average hours, average rating), `resolutionByCategory`, `oldestOverdue`, `trend` (14 days created vs resolved), `incoming` (unassigned queue), `csat` (average, distribution, recent comments), `users` |
| GET | `/analytics/me` | Candidate | `{ total, active, awaiting_you, resolved }` |

## 6. Candidate journey (`/progress`)

| Method | Path | Access | Body | Response |
|---|---|---|---|---|
| GET | `/progress/me` | Candidate | – | Roadmap: one node per official stage with its exit criteria, `activeIndex` (= official stage), `stage` (label, since, next, last decision), `readyForReview`, `percentComplete`, `blockers` (open tickets in categories flagged as blockers) |
| GET | `/progress/candidates` | Support, Admin, Facilitator (own streams) | – | Simple candidate list |
| GET | `/progress/:candidateId` | Support, Admin, Facilitator (own streams) | – | That candidate's roadmap |
| PUT | `/progress/:candidateId/requirements/:requirementId` | Support, Admin, Facilitator (own streams) | `completed` (boolean) | Updated roadmap. Awards XP and pushes a live update. **Evidence never changes the official stage**; milestone badges come from stage decisions. |

## 7. Profiles, people and notifications

| Method | Path | Access | Body | Response |
|---|---|---|---|---|
| GET | `/meta/options` | Public | – | Lists of streams, cohorts and positions |
| GET | `/profile/me` | Signed in | – | Full profile: avatar, preferences, language, accessibility needs, birthday info, programme details or staff details |
| PATCH | `/profile/me` | Signed in | `firstName?`, `surname?`, `dateOfBirth?`, `gender?` | `{ profile }` |
| PATCH | `/profile/preferences` | Signed in | `theme` (`dark`\|`light`\|`contrast`\|`system`), `textSize` (`normal`…`largest`), `font` (`default`\|`lexend`\|`atkinson`), `spacing`, `cbSafe`, `largeTargets`, `easyRead`, `readingGuide`, `reduceMotion`, `autoRead`, `speechRate` | `{ preferences }` |
| PUT | `/profile/accessibility` | Signed in | `needs[]` (from a fixed list), `notes` (≤500) | `{ accessibility }`. Visible only to the user and staff. |
| PUT | `/profile/language` | Signed in | `language` (`en`\|`zu`\|`xh`\|`af`\|`nso`) | `{ language }` |
| POST | `/profile/tour` | Signed in | `done` | `{ ok, badges[] }` |
| GET | `/people/birthdays` | Signed in | – | `{ today[], upcoming[] }`. Only the day and month are shared, never the birth year. |
| GET | `/notifications` | Signed in | – | `{ items[] }`, each with an English `title` and translatable `tkey`/`vars` |
| GET | `/candidates` | Staff | – | Candidates with programme details, open requests and accessibility flags |
| GET | `/candidates/:id` | Staff | – | Candidate profile |
| PATCH | `/candidates/:id` | Staff | `firstName?`, `surname?`, `dateOfBirth?`, `cohort?`, `stream?`, `mentor?`, `techChamp?`, `supervisor?` | `{ profile }` |

## 8. Administration (`/admin`, admin only)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/admin/users` | – | All users with role, status, temporary-password flag and workload |
| POST | `/admin/users` | `firstName`, `surname`, `email`, `role`, `dateOfBirth?`, `gender?`. Staff also need `employeeId` (and optionally `position`); candidates take the programme fields. | `201 { id, tempPassword }`. The temporary password is **shown once**, and the user must change it at first sign-in. |
| PUT | `/admin/users/:id/streams` | `streams` (array of stream names) | `{ streams }`. Facilitators only: the streams they review. Facilitators can also be created with `streams` on `POST /admin/users`. |
| POST | `/admin/users/:id/reset-password` | – | `{ tempPassword }` |
| PATCH | `/admin/users/:id` | `role?`, `isActive?` | `{ ok }`. Admins can't demote themselves, and staff with active cases can't be demoted. |
| DELETE | `/admin/users/:id` | – | `204`. Refused with `409 USER_HAS_HISTORY` if the user has any support history; deactivate them instead. |
| GET | `/admin/categories` | – | Categories with request counts |
| POST | `/admin/categories` | `name`, `description?`, `isBlocker?` | `201 { id }` |
| PATCH | `/admin/categories/:id` | `name?`, `description?`, `isActive?`, `isBlocker?` | `{ ok }` |

## 9. Engagement

| Method | Path | Access | Body / query | Response |
|---|---|---|---|---|
| GET | `/avatar/catalog` | Signed in | – | Art styles, looks, presets, palettes and items, with `locked` flags based on the user's badges |
| PUT | `/profile/avatar` | Signed in | `{ avatar: {...design} }` | `{ avatar, badges[] }`. Validated, including badge-locked items. |
| DELETE | `/profile/avatar` | Signed in | – | `204`. Reverts to the default avatar for the user's gender. |
| GET | `/avatar.svg` | Public | `c` (base64url design), `s` (expression frame) | SVG image, cached as immutable |
| GET | `/me/progress` | Signed in | – | `{ xp, level, levelProgress, levelSize, badges[] }` |
| GET | `/search` | Signed in | `q` | `{ requests[], candidates[] }`. Candidates only search their own requests. |
| GET | `/feed` | Signed in | `limit?`, `before?` | `{ posts[] }`. Candidates see global posts plus their own cohort's. |
| POST | `/feed` | Staff | `body`, `cohort?` | `201 { id }` |
| POST | `/feed/:id/react` | Signed in | `reaction` (`cheer`\|`love`\|`fire`\|`star`) | `{ active }`. Toggles the reaction. |
| DELETE | `/feed/:id` | Staff | – | `204` |
| POST | `/cammy/chat` | Signed in | `message` (≤500) | `{ reply, actions[], suggestions[{label,q}], mood?, command? }`, in the user's language |

## 10. Real-time updates

`GET /events` (signed in) is a **Server-Sent Events** stream. The event types are `request`, `notify`, `progress`, `feed`, `xp` and `people`. Events only signal that something changed; the client then fetches the data it is allowed to see, so no sensitive data travels in events.
