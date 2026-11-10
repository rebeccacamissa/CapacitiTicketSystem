# Known limitations and future recommendations

## Known limitations

### Platform and scale
| Limitation | Impact | Mitigation today |
|---|---|---|
| **Embedded database without `DATABASE_URL`** | If `DATABASE_URL` is not set, the app uses an embedded Postgres (PGlite) whose files are wiped on hosts with temporary disks | Set `DATABASE_URL` (Neon) in production; the start-up log says which database is in use |
| Live updates (SSE) and rate limits are **in-memory** | They work on a single instance only | Use Redis pub/sub and a shared rate-limit store when scaling out |
| Files are stored in the database (5 MB each) | Simple and persistent, but large volumes of files make the database big | Move to object storage such as S3 or Azure Blob at scale |
| Email needs a Resend key and a verified domain | Without them, emails are only written to the server log; no SMS | In-app notifications and live updates still work |

### Features
| Limitation | Notes |
|---|---|
| **Avatars** use open-source art | The looks (Fashion Doll Glam, Tactical Operator, Runway Dress-Up) are curated outfits and colours, not bespoke artwork. The *Polished* style has limited hair options and no headwear; *Classic* covers afros, locs, hijab and turban. |
| **No photo-based avatars** | Deliberately not built: it would mean sending candidates' faces to a third-party AI service, with privacy (POPIA) and cost implications. |
| **Cammy** is rule-based, not an AI model | She recognises a fixed set of topics and keywords. Questions outside those get a fallback answer and a prompt to raise a request. |
| **Translations** | 5 languages: English, isiZulu, isiXhosa, Afrikaans and Sepedi. They were **drafted, not professionally translated; native-speaker review is required.** Staff-only screens and avatar item names are still in English. isiNdebele, siSwati, Tshivenda and Xitsonga are not yet available. |
| **Read-aloud voices** | Depend on the voices installed on each device. Most devices have no isiZulu, isiXhosa or Sepedi voice, so the app falls back to English and says so. |
| **Voice input** | Only works in Chrome and Edge (Web Speech API). Recognition quality for South African languages varies. |
| **South African Sign Language** | Supported through an interpreter accommodation request, not translated content. |
| **Accessibility** | Designed to WCAG 2.2 AA, but **not yet tested with screen-reader users or an independent audit**. |
| **Birthdays** use the server's time zone | Correct for a South African deployment. |
| **SLA due dates** are in calendar hours | They don't skip weekends or public holidays. |
| **No password reset by e-mail** | An admin resets passwords, which issues a temporary password. |
| **Demo mode** | Must be switched off (`ALLOW_DEMO_IN_PRODUCTION=false`) for real users. |
| **AI CV tailoring** is optional and off by default | Needs an `ANTHROPIC_API_KEY` on the server; each run is a paid API call. The candidate must consent before their CV is sent to Anthropic (POPIA: personal data leaves the platform). The model is instructed never to add skills, numbers or experience, every change is listed with the original wording, gaps are reported instead of added, numbers not in a text CV are flagged, and nothing is saved until the candidate confirms it is true. Even so, **the candidate remains responsible for checking the draft**. Word (.docx) CVs must be uploaded as PDF or pasted as text for tailoring. It was **not tested against the live API** in development (no key was available); the no-key path and the safeguards are covered by tests. |
| **AI mock interviewer** | Same key, consent and cost as CV tailoring. Without a key it falls back to a fixed question bank and a self-review checklist. Not tested against the live API in development. |
| **Neon and Resend not exercised from this machine** | The Postgres code is tested on the same engine (PGlite, PostgreSQL 18) and the email flow in "log only" mode; a real `DATABASE_URL` and `RESEND_API_KEY` still need a manual check after deployment (see TESTING.md). |
| **Deleted accounts are anonymised, not erased** | Records the programme must keep (requests, audit log, stage decisions) remain, linked to "Deleted user #id". Confirm this retention approach with your information officer. |
| **Stage evidence doesn't gate decisions** | By design, a facilitator can approve a stage with criteria still unticked (the gaps are shown and should be explained in the reason). |
| **Stream names** | Facilitator scope matches the candidate's stream text exactly. Changing a candidate's stream moves them to a different facilitator. |

## Future recommendations

### Short term (before a production launch)
1. **Native-speaker review** of all translations, then add **isiNdebele, siSwati, Tshivenda and Xitsonga**. The format is already set up for this: one file in `i18n-source/`, then `npm run i18n`.
2. **An accessibility audit** with screen-reader users (NVDA, JAWS, VoiceOver) and people with disabilities from the cohort; fix what they find.
3. **SMS notifications** for candidates with limited data (email and in-app notifications exist).
4. **Browser tests** (e.g. Playwright with automated accessibility checks) alongside the existing API tests, run in **GitHub Actions** on every push.
5. Turn off demo mode, change the seed passwords, and add **database backups** (Neon point-in-time restore, plus a periodic export).

### Medium term
6. **PostgreSQL**, Redis (for live updates and rate limits) and object storage, so more than one server can run.
7. **SLA business-hours calendar** that accounts for South African public holidays, plus escalation rules (auto-notify a manager when a case goes overdue).
8. **Commissioned avatar artwork** for the three themed looks, added as a third art style; the builder already supports this.
9. **An LLM for Cammy** (e.g. Claude) with retrieval over CAPACITI policies, while keeping the current rule-based answers for safety-critical topics such as well-being.
10. **WhatsApp or SMS updates**, since many candidates rely on mobile data.
11. **Knowledge base or FAQ articles**, suggested automatically while a candidate types a request, to cut repeat tickets.

### Long term
12. **An installable app (PWA) with offline drafts**, so candidates on poor connections can write requests offline and send them later.
13. **Analytics exports and cohort reports** (CSV or PDF) for programme managers and funders.
14. **Integrations** with the learning platform (attendance, assessment marks) to tick roadmap requirements automatically.
15. **POPIA compliance tooling:** data export and deletion requests, and consent records for accessibility data.
