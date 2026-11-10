# Testing evidence

## 1. Automated tests

- **Run:** `npm test` gives a summary; `npm run test:report` gives the full report.
- **Framework:** Node's built-in test runner (`node:test` + `node:assert`). No extra test dependencies.
- **Scope:** end-to-end API tests. Each run starts the real Express app on a random port against a fresh **in-memory PostgreSQL database (PGlite)**, then makes real HTTP calls with cookies.

**Latest run: 47 passed, 0 failed** (21 core + 2 recruiter + 10 stages + 14 features). The full output is in [test-results.txt](test-results.txt).

| # | Test | What it proves |
|---|---|---|
| 1 | State machine rules (application layer) | Allowed and illegal moves; candidate restrictions; admin override |
| 2 | Registration always creates a candidate and rejects weak passwords | Users can't sign themselves up as staff; password policy |
| 3 | Candidate creates request with REQ-YYYY-NNNN reference | Reference generator; request starts as *Open* |
| 4 | Candidates cannot see other candidates' requests | Ownership enforced (404, and empty lists) |
| 5 | Illegal transition Open → Closed is rejected with 409 | `ILLEGAL_STATUS_TRANSITION`; database left unchanged |
| 6 | DB probe proves the trigger blocks illegal transitions independently | `DB_ILLEGAL_TRANSITION` from the database itself; the probe is admin-only |
| 7 | Full workflow with audit trail + candidate auto-transition on reply | Open → Assigned → In Progress → Waiting → In Progress → Resolved → Closed. Audit rows are in order, a resolution is required, internal notes are hidden from candidates, and the roadmap shows the open blocker. |
| 8 | Admin override is allowed, audited, and one-shot | Support can't override; admin can; the token is used up |
| 9 | Audit log is immutable | UPDATE and DELETE are rejected by triggers |
| 10 | Roadmap active node advances as requirements are verified | Milestone completion; candidates can't verify their own requirements |
| 11 | Analytics summary is staff-only | Role guard |
| 12 | Admin creates staff with a temporary password that must be changed | Temporary password works; the API blocks everything else until it's changed; removing a user with history is refused |
| 13 | Support can update candidate programme details; candidates cannot | Staff updates and the role guard |
| 14 | Cammy answers with personalised context | Journey reply; category detection |
| 15 | New users get a plain gender-based avatar; designs are validated and locked items enforced | Default avatar; badge locks; cross-style validation; the SVG renderer works |
| 16 | Candidate rates a resolved request; attachments are type-checked and access controlled | CSAT figures; a fake PNG is rejected; another candidate gets 404; `nosniff` header |
| 17 | Cohort feed: staff announce, everyone reacts; search is scoped | Feed permissions; reaction toggles; search can't see other candidates' requests |
| 18 | Preferences and walkthrough completion persist | Theme saved; Explorer badge awarded |
| 19 | Accessibility needs are private to the candidate and staff | Staff see the needs; candidates' own request responses don't include them |
| 20 | Language preference is saved and Cammy answers in that language | isiZulu reply; translated suggestion buttons still send the English intent |
| 21 | Extended accessibility preferences validate | High contrast, text size and font accepted; invalid values rejected |

**Recruiter tests** (`tests/recruiter.test.js`, 2) cover publishing, recruiter-only access and unpublishing.

**Stage, facilitator, portfolio and AI tests** (`tests/stages.test.js`, 10):

| # | Test | What it proves |
|---|---|---|
| S1 | Facilitators only see candidates in their streams | Other streams return 404; no access to tickets; support can't make stage decisions |
| S2 | Forward decisions go one step at a time; same-stage decisions are blocked | `STAGE_SKIP`, `STAGE_UNCHANGED`, reason required; out-of-stream decision is 404 |
| S3 | Backward moves are admin-only and need a written reason | Facilitator gets `STAGE_BACKWARD_ADMIN_ONLY`; short reason rejected; admin succeeds |
| S4 | The database rejects stage changes that bypass the rules | Raw SQL: `STAGE_AUDIT_REQUIRED`, `STAGE_SKIP`, `STAGE_NOT_AUTHORISED`, `STAGE_UNCHANGED`; the trail can't be edited or deleted |
| S5 | Stage audit trail scoping | Admin sees all, facilitator their streams, candidate their own; support and recruiters 403 |
| S6 | Pipeline counts | By stage and stream; facilitator scoped; candidates 403 |
| S7 | Portfolio files | Fake PDF rejected; wrong type per kind rejected; recruiter can open only after publishing |
| S8 | Recruiter shortlist | Saved with a note; private to each recruiter; unpublished candidates can't be added |
| S9 | AI CV tailoring without a key | Consent required; `503 AI_NOT_CONFIGURED`; reviewed drafts save as `ai_tailored` |
| S10 | Invented-number check | Numbers not in the original CV are flagged |

**Production-readiness feature tests** (`tests/features.test.js`, 14):

| # | Test | What it proves |
|---|---|---|
| F1 | Demo shortcuts off unless `DEMO_MODE=true` | Demo accounts hidden; demo sign-in returns 404 |
| F2 | Password reset | Same response for unknown and known emails; email logged; weak passwords rejected; tokens are single-use and expire |
| F3 | Candidate-requested review | Facilitator is alerted (notification and email); a stage decision resolves the request |
| F4 | Batch approval | One shared note; per-candidate results; out-of-scope ids fail safely |
| F5 | Stage targets | Candidates past the target days are flagged in candidates and pipeline |
| F6 | Evidence linking | Staff can link only the candidate's own document; "What's next" guidance is returned |
| F7 | Interview requests | Only to published candidates; no duplicates; only the invited candidate can respond; staff see them |
| F8 | Placements | Recruiter reports; confirmation only from Work Ready; confirming records an official decision to Placed |
| F9 | Talent filters | Skills (all required), cohort, documents |
| F10 | Exports | Shortlist and audit trail as CSV and PDF; spreadsheet formulas neutralised; candidates blocked |
| F11 | Programme reports | Stage times, placement rates, velocity, CSV; facilitator scoping; recruiters blocked |
| F12 | CV builder | Prefill, validation (https links), PDF download and saving to documents |
| F13 | Mock interview without AI | Question bank, answer validation, self-review feedback, owner-only |
| F14 | POPIA | Data export (no password hash), deletion request, admin anonymisation keeps the audit trail and blocks sign-in |

## 2. Database enforcement demonstration

`npm run demo:illegal` sends **raw SQL with no application code** at a fresh database. The output is in [db-enforcement-demo.txt](db-enforcement-demo.txt):

```
✘ Open → Closed (illegal jump): BLOCKED → ILLEGAL_TRANSITION
✘ Open → Resolved (illegal jump): BLOCKED → ILLEGAL_TRANSITION
✘ Open → Assigned (audited) but no assignee: BLOCKED → ASSIGNEE_REQUIRED
✘ Open → Assigned with assignee but NO audit row: BLOCKED → AUDIT_REQUIRED
✘ Tamper with audit_log: BLOCKED → AUDIT_LOG_IMMUTABLE
✘ Delete audit_log: BLOCKED → AUDIT_LOG_IMMUTABLE
✔ Open → Assigned (with audit row + assignee): accepted
```

The same check is available in the app: **Control centre → Workflow enforcement probe** (screenshot 14).

## 3. Manual and visual testing

Every page was opened in headless Chrome at 1440 px (desktop) and 390 px (mobile), with **no console errors**. The screenshots are in [`screenshots/`](screenshots) and indexed in [SCREENSHOTS.md](SCREENSHOTS.md).

**Verified visually (in the screenshots):**

| Area | Checked |
|---|---|
| Role journeys | Candidate, Support and Admin pages; demo role switcher; walkthrough; Cammy conversation; workflow probe |
| Accessibility | High-contrast theme; accessibility panel; easy-read summaries; **reflow at 320 px (equivalent to 400% zoom) with no horizontal scrolling** (measured: page width equals window width) |
| Languages | isiZulu across the menu, dashboard, roadmap, walkthrough and Cammy. The build script checks every translation keeps its `{placeholders}` and that every Cammy reply has a translation. |
| Charts | Colours checked with a palette validator for colour-blind separation and contrast on the dark background; each chart has a data table for screen readers |
| Security | Covered by the automated tests (401, 404 across candidates, 403 for the wrong role, spoofed file types rejected); CSP is set by Helmet |

**Built but not yet verified by hand (recommended before submission):**

| Area | How to check |
|---|---|
| Live updates | Sign in as a candidate and as Thabo in two browsers. Change the candidate's request status as Thabo; the candidate's page should update without a refresh. |
| Keyboard-only use | Tab through each page; press `?` for shortcuts; check every control can be reached and its focus is visible. |
| Screen reader | Run NVDA (Windows) or VoiceOver (Mac) on registration, new request and request detail; check labels, errors and announcements. |
| Read-aloud and voice input | Chrome or Edge with a microphone. Voices in isiZulu, isiXhosa and Sepedi depend on what's installed on the device. |
| Translations | A native speaker of each language should read every screen. |
| AI CV tailoring and AI interviewer | Set `ANTHROPIC_API_KEY`, upload a PDF CV as Lerato, tailor it for a real job advert, and compare the draft line by line with the original: nothing should be invented or inflated. Then run an AI practice interview. |
| Real email delivery | Set `RESEND_API_KEY` and a verified `EMAIL_FROM`, then use "Forgot your password?" and make a stage decision; check both emails arrive and links work. |
| Neon | Set `DATABASE_URL`, run `npm run db:copy-sqlite` or `npm run db:seed`, redeploy, and confirm the data survives. |
| Mobile | New and changed pages were checked in headless Chrome at 390 px: no horizontal page overflow (measured) and no script errors. Real-device testing is still recommended. |

## 4. Bugs found during testing and fixed

| Issue | Fix |
|---|---|
| The CSP blocked inline style attributes, so progress bars showed full width | Allowed `style-src-attr` only; scripts are still restricted |
| The roadmap marker sat slightly off its node while the node was animating | Measure the node's layout box instead of its animated position |
| After switching theme, some text kept the old colour (a Chrome quirk with colour mixing during transitions) | Transitions are switched off for the frame in which the theme changes |
| Avatar SVGs on one page shared IDs and broke each other's masks | Avatars are rendered as separate images |
| A quoting mistake in one script broke the whole page in non-English languages | Fixed; every browser module is now syntax-checked |
