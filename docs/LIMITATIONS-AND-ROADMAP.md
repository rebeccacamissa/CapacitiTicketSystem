# Known limitations and future recommendations

## Known limitations

### Platform and scale
| Limitation | Impact | Mitigation today |
|---|---|---|
| **SQLite** single-file database | Fine for one server and hundreds of users. It doesn't support running several server instances or very high write volumes. | WAL mode, `BEGIN IMMEDIATE` transactions and a busy timeout. Data access is isolated in services, which makes a move to PostgreSQL straightforward. |
| `node:sqlite` is marked *experimental* in Node 24 | The API could change in a future Node release | `node` is pinned at version 22.13 or later in `engines`; the warning is suppressed in scripts |
| Live updates (SSE) and rate limits are **in-memory** | They work on a single instance only | Use Redis pub/sub and a shared rate-limit store when scaling out |
| Files are stored on the local disk | They need a persistent volume; the free hosting tier loses them | Move to object storage such as S3 or Azure Blob |
| No e-mail or SMS | Users only hear about updates inside the app | In-app notifications and live updates |

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

## Future recommendations

### Short term (before a production launch)
1. **Native-speaker review** of all translations, then add **isiNdebele, siSwati, Tshivenda and Xitsonga**. The format is already set up for this: one file in `i18n-source/`, then `npm run i18n`.
2. **An accessibility audit** with screen-reader users (NVDA, JAWS, VoiceOver) and people with disabilities from the cohort; fix what they find.
3. **Self-service password reset** and **e-mail notifications** for important events: reply needed, resolved, overdue.
4. **Browser tests** (e.g. Playwright with automated accessibility checks) alongside the existing API tests, run in **GitHub Actions** on every push.
5. Turn off demo mode, change the seed passwords, and add **database backups** (a nightly SQLite backup to object storage).

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
