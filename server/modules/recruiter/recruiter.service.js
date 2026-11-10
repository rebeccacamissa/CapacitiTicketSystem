'use strict';
/**
 * Recruiter workspace: published talent, profiles, the candidate's own portfolio,
 * the private shortlist, interview requests and placement reports.
 */
const { notFound, conflict } = require('../../utils/AppError');
const { avatarOf } = require('../avatar/catalog');
const bus = require('../../realtime/bus');
const email = require('../../services/email');

function parseSkills(value) {
  const skills = JSON.parse(value || '[]');
  return Array.isArray(skills) ? skills.filter((skill) => typeof skill === 'string') : [];
}

/** Published, active candidates with their OFFICIAL stage (set only by audited stage decisions). */
async function stageCandidates(db, recruiterId = null) {
  const rows = await db.all(`
    SELECT u.id, u.full_name, u.email, u.avatar_config, u.gender, cp.stream, cp.cohort,
           p.headline, p.summary, p.skills, p.github_url, p.cv_url,
           COALESCE(cs.stage, 'enrolled') AS stage, ps.label AS stage_label, ps.sort_order AS stage_order,
           (SELECT COUNT(*) FROM portfolio_files f WHERE f.candidate_id = u.id) AS file_count,
           (SELECT COUNT(*) FROM portfolio_files f WHERE f.candidate_id = u.id AND f.kind = 'cv') AS cv_count,
           (SELECT COUNT(*) FROM portfolio_files f WHERE f.candidate_id = u.id AND f.kind = 'certificate') AS cert_count,
           s.candidate_id IS NOT NULL AS shortlisted, s.note AS shortlist_note
    FROM users u
    JOIN candidate_profiles cp ON cp.user_id = u.id
    JOIN candidate_portfolios p ON p.candidate_id = u.id AND p.is_published = 1
    LEFT JOIN candidate_stages cs ON cs.candidate_id = u.id
    JOIN programme_stages ps ON ps.key = COALESCE(cs.stage, 'enrolled')
    LEFT JOIN recruiter_shortlist s ON s.candidate_id = u.id AND s.recruiter_id = ?
    WHERE u.role = 'candidate' AND u.is_active = 1
    ORDER BY u.full_name
  `, recruiterId);

  return rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    stream: row.stream || '',
    cohort: row.cohort || '',
    headline: row.headline,
    summary: row.summary,
    skills: parseSkills(row.skills),
    githubUrl: row.github_url,
    cvUrl: row.cv_url,
    avatar: avatarOf({ avatar_config: row.avatar_config, gender: row.gender }),
    stage: row.stage,
    stageLabel: row.stage_label,
    stageOrder: row.stage_order,
    isWorkReady: row.stage_order >= 3,
    isPlaced: row.stage_order >= 4,
    fileCount: row.file_count,
    hasCv: row.cv_count > 0 || !!row.cv_url,
    hasCertificate: row.cert_count > 0,
    shortlisted: !!row.shortlisted,
    shortlistNote: row.shortlist_note || '',
  }));
}

/**
 * Talent search. q matches name, email, headline or skills; skills is a comma-separated
 * list that must ALL be present; documents: 'cv' | 'certificate' | 'any'.
 */
async function listTalent(db, { q = '', stream = '', stage = '', cohort = '', skills = '', documents = '', sort = 'name', recruiterId = null, shortlisted = false } = {}) {
  let candidates = await stageCandidates(db, recruiterId);
  if (shortlisted) candidates = candidates.filter((c) => c.shortlisted);
  if (q) {
    const term = q.toLocaleLowerCase();
    candidates = candidates.filter((c) => [c.fullName, c.email, c.headline || '', ...c.skills].some((v) => v.toLocaleLowerCase().includes(term)));
  }
  if (skills) {
    const wanted = skills.split(',').map((s) => s.trim().toLocaleLowerCase()).filter(Boolean);
    candidates = candidates.filter((c) => wanted.every((w) => c.skills.some((s) => s.toLocaleLowerCase().includes(w))));
  }
  if (stream) candidates = candidates.filter((c) => c.stream === stream);
  if (cohort) candidates = candidates.filter((c) => c.cohort === cohort);
  if (stage) candidates = candidates.filter((c) => c.stage === stage);
  if (documents === 'cv') candidates = candidates.filter((c) => c.hasCv);
  if (documents === 'certificate') candidates = candidates.filter((c) => c.hasCertificate);
  if (documents === 'any') candidates = candidates.filter((c) => c.fileCount > 0 || c.hasCv);
  if (sort === 'stage') candidates.sort((a, b) => b.stageOrder - a.stageOrder || a.fullName.localeCompare(b.fullName));
  return candidates;
}

async function summary(db, recruiterId = null) {
  const candidates = await stageCandidates(db, recruiterId);
  const distinct = (k) => [...new Set(candidates.map((c) => c[k]).filter(Boolean))].sort();
  return {
    visibleProfiles: candidates.length,
    workReadyCandidates: candidates.filter((c) => c.isWorkReady).length,
    placedCandidates: candidates.filter((c) => c.isPlaced).length,
    activeStreams: distinct('stream').length,
    shortlisted: candidates.filter((c) => c.shortlisted).length,
    streams: distinct('stream'),
    cohorts: distinct('cohort'),
    skills: [...new Set(candidates.flatMap((c) => c.skills))].sort((a, b) => a.localeCompare(b)),
  };
}

async function getPublishedProfile(db, candidateId, recruiterId = null) {
  const candidate = (await stageCandidates(db, recruiterId)).find((entry) => entry.id === candidateId);
  if (!candidate) throw notFound('Published candidate profile not found');
  const verifiedCredentials = (await db.all(`
    SELECT mr.label, m.title AS milestone, progress.completed_at AS verified_at, verifier.full_name AS verified_by
    FROM candidate_requirement_progress progress
    JOIN milestone_requirements mr ON mr.id = progress.requirement_id
    JOIN milestones m ON m.id = mr.milestone_id
    LEFT JOIN users verifier ON verifier.id = progress.verified_by
    WHERE progress.candidate_id = ?
    ORDER BY m.sort_order, mr.sort_order
  `, candidateId)).map((c) => ({ label: c.label, milestone: c.milestone, verifiedAt: c.verified_at, verifiedBy: c.verified_by }));
  const projects = await db.all(`
    SELECT id, title, description, project_url AS "projectUrl", evidence_url AS "evidenceUrl"
    FROM portfolio_items WHERE candidate_id = ? ORDER BY created_at DESC, id DESC
  `, candidateId);
  const files = await require('../portfolio/portfolio.service').list(db, candidateId);
  const interviews = recruiterId ? await db.all(`
    SELECT id, company, role_title AS "roleTitle", status, created_at AS "createdAt" FROM interview_requests
    WHERE recruiter_id = ? AND candidate_id = ? ORDER BY id DESC`, recruiterId, candidateId) : [];
  return { ...candidate, verifiedCredentials, projects, files, interviews };
}

async function getOwnPortfolio(db, candidateId) {
  await db.run('INSERT INTO candidate_portfolios (candidate_id) VALUES (?) ON CONFLICT DO NOTHING', candidateId);
  const portfolio = await db.one(`
    SELECT is_published, headline, summary, skills, github_url, cv_url FROM candidate_portfolios WHERE candidate_id = ?
  `, candidateId);
  return {
    isPublished: !!portfolio.is_published,
    headline: portfolio.headline,
    summary: portfolio.summary,
    skills: parseSkills(portfolio.skills),
    githubUrl: portfolio.github_url,
    cvUrl: portfolio.cv_url,
    projects: await db.all(`
      SELECT id, title, description, project_url AS "projectUrl", evidence_url AS "evidenceUrl"
      FROM portfolio_items WHERE candidate_id = ? ORDER BY created_at DESC, id DESC
    `, candidateId),
  };
}

async function saveOwnPortfolio(db, candidateId, data) {
  const current = await getOwnPortfolio(db, candidateId);
  const skills = data.skills === undefined ? current.skills : [...new Set(data.skills.split(',').map((skill) => skill.trim()).filter(Boolean))].slice(0, 20);
  await db.run(`
    UPDATE candidate_portfolios SET is_published = ?, headline = ?, summary = ?, skills = ?,
      github_url = ?, cv_url = ?, updated_at = now_iso()
    WHERE candidate_id = ?
  `, data.isPublished === undefined ? Number(current.isPublished) : Number(data.isPublished),
  data.headline ?? current.headline,
  data.summary ?? current.summary,
  JSON.stringify(skills),
  data.githubUrl === undefined ? current.githubUrl : data.githubUrl || null,
  data.cvUrl === undefined ? current.cvUrl : data.cvUrl || null,
  candidateId);
  return getOwnPortfolio(db, candidateId);
}

async function addProject(db, candidateId, data) {
  await getOwnPortfolio(db, candidateId);
  const id = await db.insert(`
    INSERT INTO portfolio_items (candidate_id, title, description, project_url, evidence_url) VALUES (?, ?, ?, ?, ?)
  `, candidateId, data.title, data.description || '', data.projectUrl || null, data.evidenceUrl || null);
  return db.one(`
    SELECT id, title, description, project_url AS "projectUrl", evidence_url AS "evidenceUrl" FROM portfolio_items WHERE id = ?
  `, id);
}

async function deleteProject(db, candidateId, projectId) {
  const result = await db.run('DELETE FROM portfolio_items WHERE id = ? AND candidate_id = ?', projectId, candidateId);
  if (!result.changes) throw notFound('Portfolio project not found');
}

// ---- Private shortlist (one per recruiter) -------------------------------------
async function shortlist(db, recruiterId) {
  return listTalent(db, { recruiterId, shortlisted: true });
}

async function assertPublished(db, candidateId) {
  if (!(await stageCandidates(db)).some((c) => c.id === candidateId)) throw notFound('Published candidate profile not found');
}

async function saveToShortlist(db, recruiterId, candidateId, note = '') {
  await assertPublished(db, candidateId);
  await db.run(`
    INSERT INTO recruiter_shortlist (recruiter_id, candidate_id, note) VALUES (?, ?, ?)
    ON CONFLICT (recruiter_id, candidate_id) DO UPDATE SET note = EXCLUDED.note
  `, recruiterId, candidateId, note);
  return { shortlisted: true, note };
}

async function removeFromShortlist(db, recruiterId, candidateId) {
  await db.run('DELETE FROM recruiter_shortlist WHERE recruiter_id = ? AND candidate_id = ?', recruiterId, candidateId);
  return { shortlisted: false };
}

// ---- Interview requests ------------------------------------------------------------
const INTERVIEW_SQL = `
  SELECT i.id, i.candidate_id AS "candidateId", c.full_name AS "candidateName", cp.stream,
         i.recruiter_id AS "recruiterId", r.full_name AS "recruiterName",
         i.company, i.role_title AS "roleTitle", i.message, i.proposed_at AS "proposedAt", i.mode, i.status,
         i.candidate_note AS "candidateNote", i.responded_at AS "respondedAt", i.created_at AS "createdAt"
  FROM interview_requests i
  JOIN users c ON c.id = i.candidate_id
  LEFT JOIN candidate_profiles cp ON cp.user_id = i.candidate_id
  JOIN users r ON r.id = i.recruiter_id`;

async function requestInterview(db, recruiter, candidateId, data) {
  await assertPublished(db, candidateId);
  const open = await db.one("SELECT 1 FROM interview_requests WHERE recruiter_id = ? AND candidate_id = ? AND status = 'pending'", recruiter.id, candidateId);
  if (open) throw conflict('INTERVIEW_PENDING', 'You already have a pending interview request with this candidate');
  const id = await db.insert(`
    INSERT INTO interview_requests (recruiter_id, candidate_id, company, role_title, message, proposed_at, mode) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, recruiter.id, candidateId, data.company, data.roleTitle, data.message || '', data.proposedAt || null, data.mode || 'online');
  const cand = await db.one('SELECT email, first_name, full_name FROM users WHERE id = ?', candidateId);
  email.notify(db, {
    to: cand.email, kind: 'interview_request', subject: `Interview request from ${data.company}`,
    heading: `Good news, ${cand.first_name || cand.full_name}: ${data.company} would like to interview you`,
    lines: [`Role: ${data.roleTitle}.`, ...(data.proposedAt ? [`Proposed time: ${data.proposedAt.replace('T', ' ')} (${data.mode || 'online'}).`] : []), ...(data.message ? [`Message: ${data.message}`] : []), 'Accept or decline from your dashboard.'],
    cta: { label: 'Respond on my dashboard', href: email.link('/dashboard#interviews') },
  });
  bus.publish([candidateId], 'notify', {});
  bus.publish([candidateId], 'interview', {});
  bus.publish('staff', 'interview', {});
  return db.one(`${INTERVIEW_SQL} WHERE i.id = ?`, id);
}

/** Recruiter: own requests. Candidate: requests to them. Staff (support/admin/facilitator in stream): all in scope. */
async function listInterviews(db, user) {
  if (user.role === 'recruiter') return db.all(`${INTERVIEW_SQL} WHERE i.recruiter_id = ? ORDER BY i.id DESC`, user.id);
  if (user.role === 'candidate') return db.all(`${INTERVIEW_SQL} WHERE i.candidate_id = ? ORDER BY (i.status = 'pending') DESC, i.id DESC`, user.id);
  const scope = await require('../stages/stage.rules').scopeSql(db, user);
  return db.all(`${INTERVIEW_SQL} WHERE ${scope.sql} ORDER BY i.id DESC LIMIT 300`, scope.params);
}

async function respondInterview(db, candidate, id, { accept, note }) {
  const row = await db.one("SELECT * FROM interview_requests WHERE id = ? AND candidate_id = ? AND status = 'pending'", id, candidate.id);
  if (!row) throw notFound('Pending interview request not found');
  await db.run('UPDATE interview_requests SET status = ?, candidate_note = ?, responded_at = now_iso() WHERE id = ?', accept ? 'accepted' : 'declined', note || null, id);
  const rec = await db.one('SELECT email FROM users WHERE id = ?', row.recruiter_id);
  email.notify(db, {
    to: rec.email, kind: 'interview_response', subject: `${candidate.fullName} ${accept ? 'accepted' : 'declined'} your interview request`,
    heading: `${candidate.fullName} ${accept ? 'accepted' : 'declined'} your interview request`,
    lines: [`${row.role_title} at ${row.company}.`, ...(note ? [`Their note: ${note}`] : [])],
    cta: { label: 'Open interviews', href: email.link('/interviews') },
  });
  bus.publish([row.recruiter_id], 'notify', {});
  bus.publish([row.recruiter_id], 'interview', {});
  bus.publish('staff', 'interview', {});
  return db.one(`${INTERVIEW_SQL} WHERE i.id = ?`, id);
}

async function withdrawInterview(db, recruiterId, id) {
  const { changes } = await db.run("UPDATE interview_requests SET status = 'withdrawn', responded_at = now_iso() WHERE id = ? AND recruiter_id = ? AND status = 'pending'", id, recruiterId);
  if (!changes) throw notFound('Pending interview request not found');
  const row = await db.one('SELECT candidate_id FROM interview_requests WHERE id = ?', id);
  bus.publish([row.candidate_id], 'interview', {});
  return { ok: true };
}

// ---- Placement reports ---------------------------------------------------------------
async function reportPlacement(db, recruiter, candidateId, data) {
  await assertPublished(db, candidateId);
  if (await db.one("SELECT 1 FROM placements WHERE candidate_id = ? AND status = 'pending'", candidateId)) {
    throw conflict('PLACEMENT_PENDING', 'A placement for this candidate is already waiting for confirmation');
  }
  const id = await db.insert('INSERT INTO placements (candidate_id, recruiter_id, company, role_title, start_date, note) VALUES (?, ?, ?, ?, ?, ?)',
    candidateId, recruiter.id, data.company, data.roleTitle, data.startDate || null, data.note || '');
  // Alert the candidate's stream facilitators (or admins).
  const info = await db.one('SELECT u.full_name, cp.stream FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id WHERE u.id = ?', candidateId);
  let staff = await db.all(`SELECT u.id, u.email FROM users u JOIN facilitator_streams fs ON fs.user_id = u.id
    WHERE fs.stream = ? AND u.role = 'facilitator' AND u.is_active = 1`, info.stream || '');
  if (!staff.length) staff = await db.all("SELECT id, email FROM users WHERE role = 'admin' AND is_active = 1");
  for (const s of staff) {
    email.notify(db, {
      to: s.email, kind: 'placement_report', subject: `Placement to confirm: ${info.full_name}`,
      heading: `${recruiter.fullName} reported a placement for ${info.full_name}`,
      lines: [`${data.roleTitle} at ${data.company}${data.startDate ? `, starting ${data.startDate}` : ''}.`, 'Confirming it moves the candidate to Placed (they must be Work Ready first).'],
      cta: { label: 'Review placement', href: email.link('/stage-decisions#placements') },
    });
  }
  bus.publish(staff.map((s) => s.id), 'notify', {});
  bus.publish('staff', 'people', {});
  return { id, status: 'pending' };
}

module.exports = {
  listTalent, summary, getPublishedProfile, getOwnPortfolio, saveOwnPortfolio, addProject, deleteProject,
  shortlist, saveToShortlist, removeFromShortlist,
  requestInterview, listInterviews, respondInterview, withdrawInterview, reportPlacement,
};
