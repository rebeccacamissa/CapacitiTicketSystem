# Testing evidence

## 1. Automated tests

- **Run:** `npm test` gives a summary; `npm run test:report` gives the full report.
- **Framework:** Node's built-in test runner (`node:test` + `node:assert`). No extra test dependencies.
- **Scope:** end-to-end API tests. Each run starts the real Express app on a random port against a fresh **in-memory SQLite database**, then makes real HTTP calls with cookies.

**Latest run: 21 passed, 0 failed.** The full output is in [test-results.txt](test-results.txt).

| # | Test | What it proves |
|---|---|---|
| 1 | State machine rules (application layer) | Allowed and illegal moves; candidate restrictions; admin override |
| 2 | Registration always creates a candidate and rejects weak passwords | Users can't sign themselves up as staff; password policy |
| 3 | Candidate creates request with REQ-YYYY-NNNN reference | Reference generator; request starts as *Open* |
| 4 | Candidates cannot see other candidates' requests | Ownership enforced (404, and empty lists) |
| 5 | Illegal transition Open → Closed is rejected with 409 | `ILLEGAL_STATUS_TRANSITION`; database left unchanged |
| 6 | DB probe proves the trigger blocks illegal transitions independently | `DB_ILLEGAL_TRANSITION` from SQLite itself; the probe is admin-only |
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

## 4. Bugs found during testing and fixed

| Issue | Fix |
|---|---|
| The CSP blocked inline style attributes, so progress bars showed full width | Allowed `style-src-attr` only; scripts are still restricted |
| The roadmap marker sat slightly off its node while the node was animating | Measure the node's layout box instead of its animated position |
| After switching theme, some text kept the old colour (a Chrome quirk with colour mixing during transitions) | Transitions are switched off for the frame in which the theme changes |
| Avatar SVGs on one page shared IDs and broke each other's masks | Avatars are rendered as separate images |
| A quoting mistake in one script broke the whole page in non-English languages | Fixed; every browser module is now syntax-checked |
