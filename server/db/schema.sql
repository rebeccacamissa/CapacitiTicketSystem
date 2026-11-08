-- =====================================================================
-- CAPACITI Candidate Support & Service Request System — SQLite schema
-- Owner: Member C (State Machine Core & Audit Log)
--
-- The status workflow is enforced HERE, at the database level, by:
--   * status_transitions   — whitelist of legal (from -> to) moves
--   * trg_requests_status_guard — BEFORE UPDATE trigger that RAISE(ABORT)s
--     on any illegal jump, missing assignee/resolution, or missing audit row
--   * transition_overrides — one-shot, admin-only override tokens
--   * audit_log immutability triggers (append-only)
-- The application layer validates first for friendly errors, but even a
-- raw `UPDATE requests SET status = ...` cannot bypass these rules.
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name      TEXT    NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 120),
  email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT    NOT NULL,
  role           TEXT    NOT NULL DEFAULT 'candidate'
                         CHECK (role IN ('candidate', 'support', 'admin')),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  first_name     TEXT,
  surname        TEXT,
  date_of_birth  TEXT    CHECK (date_of_birth IS NULL OR date_of_birth GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  gender         TEXT    NOT NULL DEFAULT 'prefer-not'
                         CHECK (gender IN ('female', 'male', 'non-binary', 'prefer-not')),
  -- JSON avatar design (see server/modules/avatar/catalog.js). NULL = gender-based default.
  avatar_config  TEXT    CHECK (avatar_config IS NULL OR json_valid(avatar_config)),
  preferences    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(preferences)),
  tour_done      INTEGER NOT NULL DEFAULT 0 CHECK (tour_done IN (0, 1)),
  -- Optional, self-declared accessibility needs (shared with support staff only)
  accessibility  TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(accessibility)),
  language       TEXT    NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'zu', 'xh', 'af', 'nso')),
  -- Set when an admin issues a temporary password; cleared on first password change.
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS candidate_profiles (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cohort      TEXT,
  stream      TEXT,
  mentor      TEXT,
  tech_champ  TEXT,
  supervisor  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS staff_profiles (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  position     TEXT,
  employee_id  TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS categories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  description  TEXT,
  -- Blocker categories affect programme progress (shown on the roadmap)
  is_blocker   INTEGER NOT NULL DEFAULT 0 CHECK (is_blocker IN (0, 1)),
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS request_statuses (
  name        TEXT    PRIMARY KEY,
  sort_order  INTEGER NOT NULL,
  is_terminal INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS status_transitions (
  from_status TEXT NOT NULL REFERENCES request_statuses(name),
  to_status   TEXT NOT NULL REFERENCES request_statuses(name),
  PRIMARY KEY (from_status, to_status),
  CHECK (from_status <> to_status)
);

CREATE TABLE IF NOT EXISTS priority_sla (
  priority  TEXT    PRIMARY KEY CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
  hours     INTEGER NOT NULL CHECK (hours > 0),
  rank      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reference_counters (
  year        INTEGER PRIMARY KEY,
  last_value  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reference     TEXT    NOT NULL UNIQUE CHECK (reference GLOB 'REQ-[0-9][0-9][0-9][0-9]-[0-9]*'),
  candidate_id  INTEGER NOT NULL REFERENCES users(id),
  category_id   INTEGER NOT NULL REFERENCES categories(id),
  title         TEXT    NOT NULL CHECK (length(trim(title)) BETWEEN 5 AND 150),
  description   TEXT    NOT NULL CHECK (length(trim(description)) BETWEEN 10 AND 5000),
  priority      TEXT    NOT NULL DEFAULT 'Medium' REFERENCES priority_sla(priority),
  status        TEXT    NOT NULL DEFAULT 'Open' REFERENCES request_statuses(name),
  assigned_to   INTEGER REFERENCES users(id),
  resolution    TEXT,
  due_at        TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at   TEXT,
  closed_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_requests_candidate ON requests(candidate_id);
CREATE INDEX IF NOT EXISTS idx_requests_status    ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_assignee  ON requests(assigned_to);
CREATE INDEX IF NOT EXISTS idx_requests_category  ON requests(category_id);

CREATE TABLE IF NOT EXISTS request_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id   INTEGER NOT NULL REFERENCES requests(id),
  author_id    INTEGER NOT NULL REFERENCES users(id),
  body         TEXT    NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
  is_internal  INTEGER NOT NULL DEFAULT 0 CHECK (is_internal IN (0, 1)),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_request ON request_messages(request_id);

-- Append-only activity history. Every status transition MUST have a row here.
CREATE TABLE IF NOT EXISTS audit_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id          INTEGER NOT NULL REFERENCES requests(id),
  changed_by_user_id  INTEGER NOT NULL REFERENCES users(id),
  action              TEXT    NOT NULL CHECK (action IN
                        ('CREATED', 'STATUS_CHANGE', 'ASSIGNMENT', 'PRIORITY_CHANGE')),
  old_status          TEXT    REFERENCES request_statuses(name),
  new_status          TEXT    REFERENCES request_statuses(name),
  details             TEXT,
  internal_notes      TEXT,
  is_override         INTEGER NOT NULL DEFAULT 0 CHECK (is_override IN (0, 1)),
  timestamp           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (action <> 'STATUS_CHANGE' OR (old_status IS NOT NULL AND new_status IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_audit_request ON audit_log(request_id);

-- ---------------------------------------------------------------------
-- Engagement: XP, badges, ratings, attachments, cohort feed
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS xp_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,
  ref         TEXT    NOT NULL DEFAULT '',
  points      INTEGER NOT NULL CHECK (points >= 0),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, kind, ref)   -- awarding is idempotent
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_key   TEXT    NOT NULL,
  awarded_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, badge_key)
);

CREATE TABLE IF NOT EXISTS request_ratings (
  request_id    INTEGER PRIMARY KEY REFERENCES requests(id),
  candidate_id  INTEGER NOT NULL REFERENCES users(id),
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT    CHECK (comment IS NULL OR length(comment) <= 1000),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id     INTEGER NOT NULL REFERENCES requests(id),
  uploader_id    INTEGER NOT NULL REFERENCES users(id),
  stored_name    TEXT    NOT NULL UNIQUE,
  original_name  TEXT    NOT NULL CHECK (length(original_name) BETWEEN 1 AND 200),
  mime           TEXT    NOT NULL,
  size           INTEGER NOT NULL CHECK (size > 0 AND size <= 5242880),
  is_internal    INTEGER NOT NULL DEFAULT 0 CHECK (is_internal IN (0, 1)),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_attachments_request ON attachments(request_id);

CREATE TABLE IF NOT EXISTS feed_posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL CHECK (kind IN ('announcement', 'milestone', 'badge', 'birthday')),
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  subject_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
  cohort      TEXT,
  body        TEXT    NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 1000),
  ref         TEXT    UNIQUE,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS feed_reactions (
  post_id   INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction  TEXT    NOT NULL CHECK (reaction IN ('cheer', 'love', 'fire', 'star')),
  PRIMARY KEY (post_id, user_id, reaction)
);

-- One-shot admin override tokens, consumed by the status update.
CREATE TABLE IF NOT EXISTS transition_overrides (
  request_id     INTEGER PRIMARY KEY REFERENCES requests(id),
  to_status      TEXT    NOT NULL REFERENCES request_statuses(name),
  authorized_by  INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------
-- Programme milestones (candidate roadmap)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS milestones (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT    NOT NULL UNIQUE,
  title        TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  sort_order   INTEGER NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS milestone_requirements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  milestone_id  INTEGER NOT NULL REFERENCES milestones(id),
  label         TEXT    NOT NULL,
  sort_order    INTEGER NOT NULL,
  UNIQUE (milestone_id, sort_order)
);

CREATE TABLE IF NOT EXISTS candidate_requirement_progress (
  candidate_id    INTEGER NOT NULL REFERENCES users(id),
  requirement_id  INTEGER NOT NULL REFERENCES milestone_requirements(id),
  completed_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  verified_by     INTEGER REFERENCES users(id),
  PRIMARY KEY (candidate_id, requirement_id)
);

-- =====================================================================
-- TRIGGERS — database-level state machine
-- =====================================================================

-- New requests must start in 'Open'.
CREATE TRIGGER IF NOT EXISTS trg_requests_insert_open
BEFORE INSERT ON requests
WHEN NEW.status <> 'Open'
BEGIN
  SELECT RAISE(ABORT, 'ILLEGAL_TRANSITION: new requests must start in Open');
END;

-- Core guard: every status change is validated against the whitelist
-- (or a valid admin override token), and must already be audited.
CREATE TRIGGER IF NOT EXISTS trg_requests_status_guard
BEFORE UPDATE OF status ON requests
WHEN OLD.status IS NOT NEW.status
BEGIN
  SELECT RAISE(ABORT, 'ILLEGAL_TRANSITION: transition not permitted by workflow')
  WHERE NOT EXISTS (
          SELECT 1 FROM status_transitions
          WHERE from_status = OLD.status AND to_status = NEW.status)
    AND NOT EXISTS (
          SELECT 1 FROM transition_overrides o
          JOIN users u ON u.id = o.authorized_by
          WHERE o.request_id = NEW.id
            AND o.to_status = NEW.status
            AND u.role = 'admin' AND u.is_active = 1);

  SELECT RAISE(ABORT, 'ASSIGNEE_REQUIRED: request must be assigned to a staff member')
  WHERE NEW.status IN ('Assigned', 'In Progress', 'Waiting for Candidate')
    AND NEW.assigned_to IS NULL;

  SELECT RAISE(ABORT, 'RESOLUTION_REQUIRED: a resolution must be recorded')
  WHERE NEW.status = 'Resolved'
    AND (NEW.resolution IS NULL OR length(trim(NEW.resolution)) = 0);

  -- The most recent audit row for this request must describe exactly this move.
  SELECT RAISE(ABORT, 'AUDIT_REQUIRED: status change has no matching audit_log entry')
  WHERE NOT EXISTS (
          SELECT 1 FROM audit_log a
          WHERE a.id = (SELECT MAX(id) FROM audit_log WHERE request_id = NEW.id)
            AND a.action = 'STATUS_CHANGE'
            AND a.old_status = OLD.status
            AND a.new_status = NEW.status);
END;

-- Assignee must be active staff.
CREATE TRIGGER IF NOT EXISTS trg_requests_assignee_staff
BEFORE UPDATE OF assigned_to ON requests
WHEN NEW.assigned_to IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'INVALID_ASSIGNEE: assignee must be active support or admin staff')
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.assigned_to
                    AND role IN ('support', 'admin') AND is_active = 1);
END;

-- Consume the override token once used.
CREATE TRIGGER IF NOT EXISTS trg_requests_consume_override
AFTER UPDATE OF status ON requests
BEGIN
  DELETE FROM transition_overrides WHERE request_id = NEW.id;
END;

-- Audit log is append-only.
CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_LOG_IMMUTABLE: audit entries cannot be modified');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_LOG_IMMUTABLE: audit entries cannot be deleted');
END;

-- =====================================================================
-- REFERENCE DATA
-- =====================================================================
INSERT OR IGNORE INTO request_statuses (name, sort_order, is_terminal) VALUES
  ('Open', 1, 0), ('Assigned', 2, 0), ('In Progress', 3, 0),
  ('Waiting for Candidate', 4, 0), ('Resolved', 5, 0), ('Closed', 6, 1),
  ('Reopened', 7, 0);

INSERT OR IGNORE INTO status_transitions (from_status, to_status) VALUES
  ('Open', 'Assigned'),
  ('Assigned', 'In Progress'),
  ('In Progress', 'Waiting for Candidate'),
  ('In Progress', 'Resolved'),
  ('Waiting for Candidate', 'In Progress'),
  ('Waiting for Candidate', 'Resolved'),
  ('Resolved', 'Closed'),
  ('Resolved', 'Reopened'),
  ('Closed', 'Reopened'),
  ('Reopened', 'Assigned'),
  ('Reopened', 'In Progress');

INSERT OR IGNORE INTO priority_sla (priority, hours, rank) VALUES
  ('Low', 120, 1), ('Medium', 72, 2), ('High', 24, 3), ('Urgent', 4, 4);

INSERT OR IGNORE INTO categories (name, description, is_blocker) VALUES
  ('Technical support',        'Laptop, software and device issues', 1),
  ('Learning platform access', 'Login or access problems with learning platforms', 1),
  ('Connectivity',             'Data, Wi-Fi or network problems', 1),
  ('Attendance',               'Attendance records, absences and leave', 1),
  ('Course content',           'Questions about modules and materials', 0),
  ('Assessments',              'Assessment submissions, marks and re-assessments', 0),
  ('Career support',           'CVs, interviews and placement guidance', 0),
  ('Administration',           'Documents, stipends and contracts', 0),
  ('Well-being referral',      'Confidential well-being support referral', 0),
  ('General enquiry',          'Anything else', 0),
  ('Accessibility support',    'Assistive technology, SASL interpreters, extra time and other accommodations', 1);

INSERT OR IGNORE INTO milestones (key, title, description, sort_order) VALUES
  ('screening',  'Application & Screening',      'Your application is reviewed and you complete the screening steps.', 1),
  ('onboarding', 'Enrolled & Onboarding',        'You are accepted into a cohort and set up for training.', 2),
  ('training',   'In Training & Active Support', 'You attend training, complete modules and pass assessments.', 3),
  ('work_ready', 'Work Ready',                   'You are prepared and signed off for the workplace.', 4),
  ('placed',     'Corporate Internship Placed',  'You start your internship with a corporate partner.', 5);

INSERT OR IGNORE INTO milestone_requirements (milestone_id, label, sort_order)
SELECT m.id, r.label, r.ord FROM milestones m JOIN (
  SELECT 'screening' k, 'Application form submitted' label, 1 ord UNION ALL
  SELECT 'screening', 'Supporting documents verified', 2 UNION ALL
  SELECT 'screening', 'Aptitude assessment completed', 3 UNION ALL
  SELECT 'screening', 'Screening interview completed', 4 UNION ALL
  SELECT 'onboarding', 'Offer accepted and contract signed', 1 UNION ALL
  SELECT 'onboarding', 'Learning platform account activated', 2 UNION ALL
  SELECT 'onboarding', 'Device and connectivity set up', 3 UNION ALL
  SELECT 'onboarding', 'Orientation session attended', 4 UNION ALL
  SELECT 'training', 'Core modules completed', 1 UNION ALL
  SELECT 'training', 'Attendance at or above 80%', 2 UNION ALL
  SELECT 'training', 'All assessments passed', 3 UNION ALL
  SELECT 'training', 'Capstone project submitted', 4 UNION ALL
  SELECT 'work_ready', 'CV reviewed and approved', 1 UNION ALL
  SELECT 'work_ready', 'Mock interview completed', 2 UNION ALL
  SELECT 'work_ready', 'Work-readiness workshop attended', 3 UNION ALL
  SELECT 'placed', 'Matched with a corporate partner', 1 UNION ALL
  SELECT 'placed', 'Internship agreement signed', 2 UNION ALL
  SELECT 'placed', 'First day at host company', 3
) r ON r.k = m.key;
