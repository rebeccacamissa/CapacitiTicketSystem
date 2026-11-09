# User roles

The system has five roles: the three core roles below, plus **Facilitator** and **Recruiter** (see [Facilitator and Recruiter](#facilitator-and-recruiter)). Each role is checked **on the server** on every request: the route guard `authorize(...)`, ownership checks in the services, and the database triggers. Hiding a button in the interface is never the only protection.

| | Candidate | Support / Manager | Administrator |
|---|---|---|---|
| **Who** | A learner on a CAPACITI programme | Programme managers and support specialists | Operations leads who run the platform |
| **How the account is created** | Self-registration (`/register`) | Created by an admin, with a temporary password | Created by an admin, with a temporary password |
| **Home page after sign-in** | `/dashboard`: *My dashboard* | `/insights`: *Support dashboard* | `/admin`: *Control centre* |
| **Demo account** | `lerato@example.com` | `thabo@capaciti.org.za` | `admin@capaciti.org.za` |

All demo passwords are `Capaciti@2026`. When demo mode is on, the **View as** switcher in the top bar and the one-click buttons on the sign-in page switch roles instantly.

## Permission matrix

| Capability | Candidate | Support | Admin |
|---|:-:|:-:|:-:|
| Register yourself | ✔ (always as candidate) | – | – |
| Create a support request (reference generated automatically) | ✔ | – | – |
| See requests | Own only (404 for others) | All | All |
| Search, filter and sort requests | Own | All | All |
| Reply to a request | ✔ | ✔ | ✔ |
| Add **internal notes** and internal attachments | – | ✔ | ✔ |
| Attach files | ✔ | ✔ | ✔ |
| Assign or reassign, change priority | – | ✔ | ✔ |
| Status transitions | Only: reply on *Waiting* → *In Progress* (automatic), *Resolved* → *Closed* (accept), *Resolved/Closed* → *Reopened* | All moves in the state machine | All, **plus an audited override** of the state machine |
| Rate a resolved request (1–5 stars) | ✔ | – | – |
| See your own roadmap and progress | ✔ | – | – |
| Verify a candidate's stage evidence (exit-criteria checklist) | – | ✔ | ✔ |
| Approve an official stage decision (one step forward) | – | – | ✔ (facilitators too, for their streams) |
| Move a candidate back a stage (written reason required) | – | – | ✔ |
| View the stage audit trail | Own decisions | – | All |
| Programme pipeline (candidates by stage and stream) | – | – | ✔ |
| Upload portfolio documents (CV, project, certificate) | ✔ | – | – |
| AI CV tailoring (optional, needs consent) | ✔ | – | – |
| Update a candidate's cohort, stream, mentor, Tech Champ, supervisor | – | ✔ | ✔ |
| See a candidate's accessibility needs | Own | ✔ | ✔ |
| Support dashboard and analytics (queue, workload, CSAT, trends) | – | ✔ | ✔ |
| Post announcements to the cohort feed | – | ✔ | ✔ |
| React to feed posts | ✔ | ✔ | ✔ |
| Add, deactivate or remove users; change roles; reset passwords | – | – | ✔ |
| Manage request categories (including "blocker" flags) | – | – | ✔ |
| Run the database enforcement probe | – | – | ✔ |
| Avatar studio, accessibility settings, language, Cammy | ✔ | ✔ | ✔ (staff have all avatar items unlocked) |

## Facilitator and Recruiter

| | Facilitator | Recruiter |
|---|---|---|
| **Who** | Learning facilitators responsible for one or more streams | Talent partners looking for work-ready candidates |
| **How the account is created** | Created by an admin, who assigns their stream(s) | Created by an admin |
| **Home page** | `/facilitator`: *My streams* | `/recruiter`: *Recruiter overview* |
| **Demo account** | `facilitator@capaciti.org.za` (Software Development, Data Science & Analytics, Cybersecurity) | `recruiter@capaciti.org.za` |

| Capability | Facilitator | Recruiter |
|---|:-:|:-:|
| See candidates | Only those in their assigned streams (others return 404) | Only candidates who **published** their portfolio |
| Verify stage evidence (exit-criteria checklist) | ✔ (their streams) | – |
| Approve the next official stage, with a reason | ✔ (their streams, one step forward only) | – |
| Move a candidate back a stage | – (admin only) | – |
| Stage audit trail | Their streams | – |
| Open portfolio documents | Their streams | Published portfolios only |
| Private, saved shortlist with notes | – | ✔ (visible only to that recruiter) |
| Support tickets, analytics, admin | – | – |

### Official stages

Every candidate has one **official stage**: Enrolled → In Training → Work Ready → Placed → Completed.

- A stage changes **only** through a stage decision: who decided, when, and why are stored in the append-only `stage_decisions` trail.
- Forward decisions move **one step at a time** (no skipping). A decision to the stage the candidate is already at is rejected.
- **Backward** moves are admin-only and need a written reason (at least 10 characters).
- Each stage has a checklist of exit criteria. These are **supporting evidence**: ticking them never changes the stage, but when every item is ticked the candidate shows as *Ready for review* to their facilitator.
- The rules are checked in the API **and** by database triggers, so a raw SQL write can't bypass them.

## Role walk-throughs

### Candidate
1. **Register.** Enter name, surname, date of birth and gender, then programme details (optional), then a password. Finally, design an avatar or keep the plain default.
2. **First sign-in.** Cammy runs a guided walkthrough.
3. **Dashboard.**
   - A hero card showing your avatar, level and XP, plus quick stats.
   - A live **journey roadmap** across 5 milestones. Click a milestone to see what's done and what's left.
   - A birthday countdown and your programme team.
   - Recent requests, the cohort feed and upcoming birthdays.
4. **Get help.** Choose a category and priority, describe the problem, attach files and submit. You get a reference such as `REQ-2026-0042`.
5. **Follow up.** Updates arrive live. Reply when the team is *Waiting for Candidate*. When a request is resolved, accept or reopen it, then rate the support.

### Support / Manager
1. **Support dashboard.**
   - The incoming queue, with one-click **Assign to me**.
   - Staff workload, including overdue cases and average ratings.
   - A 14-day trend, status pipeline, category and priority breakdowns, satisfaction scores and the most overdue cases.
2. **Ticket queue.** Filter by assignee, status, category, priority or overdue.
3. **Request detail.**
   - Assign, change priority and move status through the permitted next steps.
   - Write public replies or internal notes.
   - See the candidate's accessibility needs and the full audit trail.
4. **Candidates.** Edit programme details and verify roadmap requirements. The candidate's dashboard updates live.

### Administrator
Everything Support can do, plus:
- **Control centre.** Add users, which generates a temporary password shown once and forces a change at first sign-in. Change roles, reset passwords, deactivate users, and remove users who have no history.
- **Categories.** Add categories and toggle whether each one is active or a blocker.
- **Workflow override.** Force a status change outside the normal workflow. It is recorded in the audit log as an override.
- **Enforcement probe.** Proves the database itself blocks illegal transitions.

## Security safeguards

- **Passwords and sessions:**
  - passwords are hashed with bcrypt (12 rounds);
  - the session JWT is in an httpOnly, SameSite=Strict cookie, marked Secure in production;
  - login and registration are rate limited, and responses for unknown e-mails take about as long as for real ones, so attackers can't tell which accounts exist.
- **Permission checks:**
  - a user's role and active status are re-read from the database on every request, so demotions and deactivations take effect immediately;
  - self-registration can never create staff accounts, and admins can't remove their own admin access.
- **Data and browser protection:**
  - all SQL is parameterised, and sort columns come from a fixed list;
  - Helmet sets a Content Security Policy, and scripts are allowed only from the app itself;
  - uploaded files are checked by their real contents, stored outside the web root and served sandboxed.
